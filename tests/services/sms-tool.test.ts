import { SMSTool } from '../../src/services/sms-tool';
import { testSupabase, cleanupTestData } from '../helpers/database';
import { mockConsole } from '../helpers/mocks';

describe('SMSTool', () => {
  let smsTool: SMSTool;
  let consoleMock: ReturnType<typeof mockConsole>;

  beforeAll(() => {
    smsTool = new SMSTool(testSupabase);
    consoleMock = mockConsole();
  });

  afterAll(() => {
    consoleMock.restore();
  });

  afterEach(async () => {
    await cleanupTestData();
    jest.clearAllMocks();
  });

  describe('sendSMS', () => {
    it('should validate phone number format', async () => {
      const invalidNumbers = [
        'invalid',
        '123',
        'abcdefg',
        '',
        '000-000-0000'
      ];

      for (const invalidNumber of invalidNumbers) {
        const result = await smsTool.sendSMS({
          to: invalidNumber,
          message: 'Test message'
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid phone number format');
      }
    });

    it('should accept valid phone number formats', async () => {
      const validNumbers = [
        '+1234567890',
        '+12345678901',
        '1234567890',
        '+441234567890',
        '+33123456789'
      ];

      for (const validNumber of validNumbers) {
        const result = await smsTool.sendSMS({
          to: validNumber,
          message: 'Test message'
        });

        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it('should log SMS details in development mode', async () => {
      const result = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test SMS message',
        fromName: 'Test Business'
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev_sms_/);
      
      // Verify console.log was called with SMS details
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith('=== SMS MESSAGE ===');
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith('To: +1234567890');
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith('From: Test Business');
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith('Message: Test SMS message');
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith('==================');
    });

    it('should handle missing fromName gracefully', async () => {
      const result = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test message'
      });

      expect(result.success).toBe(true);
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith('From: Adventure Harmony');
    });

    it('should generate unique message IDs', async () => {
      const result1 = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test message 1'
      });

      const result2 = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test message 2'
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.messageId).not.toBe(result2.messageId);
    });
  });

  describe('sendFormLink', () => {
    it('should send form link with proper message formatting', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/123',
        'Booking Form',
        'Test Outfitter'
      );

      expect(result.success).toBe(true);
      
      // Check that the message was formatted correctly
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith(
        'Message: Hi! Test Outfitter has sent you a form to fill out: "Booking Form". Please click here to complete it: https://example.com/form/123'
      );
    });

    it('should use default business name when not provided', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/123',
        'Contact Form'
      );

      expect(result.success).toBe(true);
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith(
        'Message: Hi! Adventure Harmony has sent you a form to fill out: "Contact Form". Please click here to complete it: https://example.com/form/123'
      );
    });

    it('should handle invalid phone numbers', async () => {
      const result = await smsTool.sendFormLink(
        'invalid-phone',
        'https://example.com/form/123',
        'Test Form'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phone number format');
    });

    it('should return success with messageId for valid requests', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/123',
        'Test Form',
        'Test Business'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^dev_sms_/);
      expect(result.error).toBeUndefined();
    });
  });

  describe('getToolDefinition', () => {
    it('should return valid tool definition for general SMS', () => {
      const definition = SMSTool.getToolDefinition();

      expect(definition).toMatchObject({
        name: 'SMS_SendMessage',
        description: expect.stringContaining('Sends SMS text messages'),
        inputSchema: {
          type: 'object',
          properties: expect.objectContaining({
            to: expect.any(Object),
            message: expect.any(Object),
            fromName: expect.any(Object)
          }),
          required: expect.arrayContaining(['to', 'message'])
        }
      });
    });

    it('should have fromName as optional parameter', () => {
      const definition = SMSTool.getToolDefinition();
      
      expect(definition.inputSchema.required).not.toContain('fromName');
      expect(definition.inputSchema.properties.fromName).toHaveProperty('description');
    });
  });

  describe('getFormLinkToolDefinition', () => {
    it('should return valid tool definition for form links', () => {
      const definition = SMSTool.getFormLinkToolDefinition();

      expect(definition).toMatchObject({
        name: 'SMS_SendFormLink',
        description: expect.stringContaining('Send form link via SMS'),
        inputSchema: {
          type: 'object',
          properties: expect.objectContaining({
            phoneNumber: expect.any(Object),
            formUrl: expect.any(Object),
            formTitle: expect.any(Object),
            businessName: expect.any(Object)
          }),
          required: expect.arrayContaining(['phoneNumber', 'formUrl', 'formTitle'])
        }
      });
    });

    it('should have businessName as optional parameter with default', () => {
      const definition = SMSTool.getFormLinkToolDefinition();
      
      expect(definition.inputSchema.required).not.toContain('businessName');
      expect(definition.inputSchema.properties.businessName).toHaveProperty('default', 'Adventure Harmony');
    });
  });
});