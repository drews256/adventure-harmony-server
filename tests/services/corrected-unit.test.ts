import { FormGenerator } from '../../src/services/form-generator';
import { SMSTool } from '../../src/services/sms-tool';

// Mock Supabase for unit testing
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null })
};

describe('Corrected Unit Tests', () => {
  describe('FormGenerator Tool Definition', () => {
    it('should have correct tool definition', () => {
      const definition = FormGenerator.getToolDefinition();
      
      expect(definition.name).toBe('FormGenerator_CreateForm');
      expect(definition.description).toContain('mobile-optimized React form');
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.required).toContain('formTitle');
      expect(definition.inputSchema.required).toContain('formType');
      expect(definition.inputSchema.required).toContain('fields');
      expect(definition.inputSchema.required).toContain('originatingProfileId');
    });
  });

  describe('SMSTool Implementation', () => {
    let smsTool: SMSTool;
    let consoleSpy: jest.SpyInstance;

    beforeAll(() => {
      smsTool = new SMSTool(mockSupabase);
    });

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should have correct tool definition', () => {
      const definition = SMSTool.getToolDefinition();
      
      expect(definition.name).toBe('SMS_SendMessage');
      expect(definition.description).toContain('Sends SMS text messages');
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.required).toContain('to');
      expect(definition.inputSchema.required).toContain('message');
      expect(definition.inputSchema.required).not.toContain('fromName');
    });

    it('should validate phone number formats correctly', async () => {
      // Test invalid phone numbers - these should fail
      const invalidNumbers = ['invalid', '123', '', '000-000-0000'];
      
      for (const phoneNumber of invalidNumbers) {
        const result = await smsTool.sendSMS({
          to: phoneNumber,
          message: 'Test message'
        });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid phone number format');
      }
    });

    it('should accept valid phone number formats', async () => {
      const validNumbers = ['+1234567890', '1234567890', '+441234567890'];
      
      for (const phoneNumber of validNumbers) {
        const result = await smsTool.sendSMS({
          to: phoneNumber,
          message: 'Test message'
        });
        
        expect(result.success).toBe(true);
        expect(result.messageId).toMatch(/^dev_sms_/); // Actual prefix is dev_sms_
        expect(result.error).toBeUndefined();
      }
    });

    it('should log SMS messages in development mode', async () => {
      const result = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test message content',
        fromName: 'Test Business'
      });
      
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev_sms_/);
      
      // Verify console logging format
      expect(consoleSpy).toHaveBeenCalledWith('=== SMS MESSAGE ===');
      expect(consoleSpy).toHaveBeenCalledWith('To: +1234567890');
      expect(consoleSpy).toHaveBeenCalledWith('From: Test Business');
      expect(consoleSpy).toHaveBeenCalledWith('Message: Test message content');
      expect(consoleSpy).toHaveBeenCalledWith('==================');
    });

    it('should use default business name when not provided', async () => {
      const result = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test message'
      });
      
      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('From: Adventure Harmony');
    });

    it('should format form link messages correctly', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/abc123',
        'Booking Form',
        'Adventure Outfitters'
      );
      
      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev_sms_/);
      
      // Check that the correct message was formatted and logged
      expect(consoleSpy).toHaveBeenCalledWith(
        'Message: Hi! Adventure Outfitters has sent you a form to fill out: "Booking Form". Please click here to complete it: https://example.com/form/abc123'
      );
    });

    it('should handle form link with default business name', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/abc123',
        'Contact Form'
        // No business name provided - should use default
      );
      
      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('From: Adventure Harmony');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Message: Hi! Adventure Harmony has sent you a form to fill out: "Contact Form". Please click here to complete it: https://example.com/form/abc123'
      );
    });

    it('should handle invalid phone numbers in form links', async () => {
      const result = await smsTool.sendFormLink(
        'invalid-phone',
        'https://example.com/form/abc123',
        'Test Form'
      );
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phone number format');
    });
  });

  describe('Phone Number Validation Logic', () => {
    let smsTool: SMSTool;

    beforeAll(() => {
      smsTool = new SMSTool(mockSupabase);
    });

    it('should correctly implement phone number regex', async () => {
      // The regex is: /^\+?[1-9]\d{1,14}$/
      // This means: optional +, digit 1-9, then 1-14 more digits
      
      const testCases = [
        // Valid cases
        { phone: '+1234567890', expected: true },
        { phone: '1234567890', expected: true },
        { phone: '+441234567890', expected: true },
        { phone: '7234567890', expected: true },
        { phone: '+9123456789012345', expected: true }, // 15 digits total
        
        // Invalid cases
        { phone: '', expected: false },
        { phone: '123', expected: false }, // Too short
        { phone: '0234567890', expected: false }, // Starts with 0
        { phone: '+0234567890', expected: false }, // Starts with +0
        { phone: 'invalid', expected: false },
        { phone: '123-456-7890', expected: false }, // Would be cleaned but still start with 1, so might be valid
        { phone: '+12345678901234567890', expected: false } // Too long
      ];

      for (const testCase of testCases) {
        const result = await smsTool.sendSMS({
          to: testCase.phone,
          message: 'Test'
        });
        
        expect(result.success).toBe(testCase.expected);
        if (!testCase.expected) {
          expect(result.error).toContain('Invalid phone number format');
        }
      }
    });
  });
});