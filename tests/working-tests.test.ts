/**
 * Working End-to-End Tests for Form System
 * These tests validate the core functionality without requiring external dependencies
 */

import { FormGenerator } from '../src/services/form-generator';
import { SMSTool } from '../src/services/sms-tool';

// Mock Supabase to avoid database dependency
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null })
};

describe('Form System End-to-End Tests', () => {
  let formGenerator: FormGenerator;
  let smsTool: SMSTool;

  beforeAll(() => {
    formGenerator = new FormGenerator(mockSupabase);
    smsTool = new SMSTool(mockSupabase);
  });

  describe('1. Tool Definitions and Configuration', () => {
    it('FormGenerator should have correct tool definition', () => {
      const definition = FormGenerator.getToolDefinition();
      
      expect(definition.name).toBe('FormGenerator_CreateForm');
      expect(definition.description).toContain('mobile-optimized React form');
      expect(definition.inputSchema.type).toBe('object');
      
      // Verify required fields
      expect(definition.inputSchema.required).toContain('formTitle');
      expect(definition.inputSchema.required).toContain('formType');
      expect(definition.inputSchema.required).toContain('fields');
      expect(definition.inputSchema.required).toContain('originatingProfileId');
      
      // Verify field schema
      expect(definition.inputSchema.properties.fields.type).toBe('array');
      expect(definition.inputSchema.properties.fields.items).toBeDefined();
    });

    it('SMSTool should have correct tool definition', () => {
      const definition = SMSTool.getToolDefinition();
      
      expect(definition.name).toBe('SMS_SendMessage');
      expect(definition.description).toContain('Sends SMS text messages');
      expect(definition.inputSchema.type).toBe('object');
      
      // Verify required fields
      expect(definition.inputSchema.required).toContain('to');
      expect(definition.inputSchema.required).toContain('message');
      expect(definition.inputSchema.required).not.toContain('fromName');
    });

    it('Tools should have unique names and compatible schemas', () => {
      const formDef = FormGenerator.getToolDefinition();
      const smsDef = SMSTool.getToolDefinition();
      
      expect(formDef.name).not.toBe(smsDef.name);
      expect(formDef.name).toMatch(/^FormGenerator_/);
      expect(smsDef.name).toMatch(/^SMS_/);
      
      // Both should have valid JSON schemas
      expect(formDef.inputSchema.type).toBe('object');
      expect(smsDef.inputSchema.type).toBe('object');
      expect(Array.isArray(formDef.inputSchema.required)).toBe(true);
      expect(Array.isArray(smsDef.inputSchema.required)).toBe(true);
    });
  });

  describe('2. SMS Phone Number Validation', () => {
    it('should validate phone numbers correctly', async () => {
      // Test valid phone numbers (10-15 digits, no leading zeros)
      const validNumbers = ['+1234567890', '1234567890', '+441234567890', '12345678901', '+447123456789'];
      
      for (const phone of validNumbers) {
        const result = await smsTool.sendSMS({ to: phone, message: 'Test' });
        expect(result.success).toBe(true);
        expect(result.messageId).toMatch(/^dev_sms_/);
        expect(result.error).toBeUndefined();
      }
    });

    it('should reject invalid phone numbers', async () => {
      const invalidNumbers = [
        '', // empty
        'invalid', // not numeric
        '0123456789', // starts with 0
        '+0123456789', // starts with +0
        '123', // too short (less than 10 digits)
        '12345', // too short
        '123456789012345678', // too long (more than 15 digits)
        '+123456789012345678' // too long with +
      ];
      
      for (const phone of invalidNumbers) {
        const result = await smsTool.sendSMS({ to: phone, message: 'Test' });
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid phone number format');
      }
    });

    it('should clean phone numbers by removing formatting', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await smsTool.sendSMS({ 
        to: '+1 (234) 567-8900', 
        message: 'Test formatted number' 
      });
      
      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('To: +12345678900');
      
      consoleSpy.mockRestore();
    });
  });

  describe('3. SMS Message Formatting', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should format basic SMS messages correctly', async () => {
      const result = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Hello, this is a test message!',
        fromName: 'Test Business'
      });

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('=== SMS MESSAGE ===');
      expect(consoleSpy).toHaveBeenCalledWith('To: +1234567890');
      expect(consoleSpy).toHaveBeenCalledWith('From: Test Business');
      expect(consoleSpy).toHaveBeenCalledWith('Message: Hello, this is a test message!');
      expect(consoleSpy).toHaveBeenCalledWith('==================');
    });

    it('should use default business name when not provided', async () => {
      await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test with default name'
      });

      expect(consoleSpy).toHaveBeenCalledWith('From: Adventure Harmony');
    });

    it('should format form link messages correctly', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/abc123',
        'Adventure Booking Form',
        'Mountain Adventures'
      );

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('From: Mountain Adventures');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Message: Hi! Mountain Adventures has sent you a form to fill out: "Adventure Booking Form". Please click here to complete it: https://example.com/form/abc123'
      );
    });

    it('should handle form links with default business name', async () => {
      await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/def456',
        'Contact Form'
      );

      expect(consoleSpy).toHaveBeenCalledWith('From: Adventure Harmony');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Message: Hi! Adventure Harmony has sent you a form to fill out: "Contact Form". Please click here to complete it: https://example.com/form/def456'
      );
    });
  });

  describe('4. Form Generation Logic (Unit Level)', () => {
    // Mock the database insert to succeed
    beforeEach(() => {
      mockSupabase.insert.mockReturnThis();
      mockSupabase.single.mockResolvedValue({ 
        data: { id: 'form_test_123' }, 
        error: null 
      });
    });

    it('should create form with minimal required fields', async () => {
      const formArgs = {
        formTitle: 'Test Form',
        formType: 'contact',
        fields: [
          { name: 'name', label: 'Full Name', type: 'text' as const, required: true }
        ],
        originatingProfileId: 'profile_123'
      };

      const result = await formGenerator.createForm(formArgs);

      expect(result.url).toContain('/form/');
      expect(result.formId).toMatch(/^form_/);
      expect(mockSupabase.from).toHaveBeenCalledWith('dynamic_forms');
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should handle complex form fields', async () => {
      const formArgs = {
        formTitle: 'Complex Application',
        formType: 'application',
        fields: [
          { name: 'name', label: 'Full Name', type: 'text' as const, required: true },
          { name: 'email', label: 'Email', type: 'email' as const, required: true },
          { name: 'age', label: 'Age', type: 'number' as const },
          { name: 'terms', label: 'Accept Terms', type: 'checkbox' as const, required: true },
          { name: 'bio', label: 'Biography', type: 'textarea' as const },
          { name: 'date', label: 'Preferred Date', type: 'date' as const }
        ],
        originatingProfileId: 'profile_complex',
        customerPhone: '+1555123456'
      };

      const result = await formGenerator.createForm(formArgs);

      expect(result.url).toBeTruthy();
      expect(result.formId).toBeTruthy();
      expect(mockSupabase.insert).toHaveBeenCalled();
    });

    it('should handle expiration settings', async () => {
      const formArgs = {
        formTitle: 'Expiring Form',
        formType: 'booking',
        fields: [
          { name: 'name', label: 'Name', type: 'text' as const }
        ],
        originatingProfileId: 'profile_expire',
        expiresInHours: 48
      };

      const result = await formGenerator.createForm(formArgs);

      expect(result.expiresAt).toBeTruthy();
      expect(new Date(result.expiresAt!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('5. Error Handling and Edge Cases', () => {
    it('should reject form creation with empty fields', async () => {
      const formArgs = {
        formTitle: 'Empty Form',
        formType: 'test',
        fields: [],
        originatingProfileId: 'profile_empty'
      };

      await expect(formGenerator.createForm(formArgs)).rejects.toThrow('At least one field is required to create a form');
    });

    it('should reject form creation with missing required fields', async () => {
      // Test missing form title
      await expect(formGenerator.createForm({
        formTitle: '',
        formType: 'test',
        fields: [{ name: 'test', label: 'Test', type: 'text' as const }],
        originatingProfileId: 'profile_test'
      })).rejects.toThrow('Form title is required');

      // Test missing form type
      await expect(formGenerator.createForm({
        formTitle: 'Test Form',
        formType: '',
        fields: [{ name: 'test', label: 'Test', type: 'text' as const }],
        originatingProfileId: 'profile_test'
      })).rejects.toThrow('Form type is required');

      // Test missing originating profile ID
      await expect(formGenerator.createForm({
        formTitle: 'Test Form',
        formType: 'test',
        fields: [{ name: 'test', label: 'Test', type: 'text' as const }],
        originatingProfileId: ''
      })).rejects.toThrow('Originating profile ID is required');
    });

    it('should handle SMS sending errors gracefully', async () => {
      const result = await smsTool.sendFormLink(
        'invalid',
        'https://example.com/form/123',
        'Test Form'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid phone number format');
    });

    it('should generate unique IDs for forms and SMS messages', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      // Generate multiple SMS messages
      const results = await Promise.all([
        smsTool.sendSMS({ to: '+1111111111', message: 'Test 1' }),
        smsTool.sendSMS({ to: '+2222222222', message: 'Test 2' }),
        smsTool.sendSMS({ to: '+3333333333', message: 'Test 3' })
      ]);

      // All should succeed with unique IDs
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.messageId).toMatch(/^dev_sms_/);
      });

      // IDs should be unique
      const messageIds = results.map(r => r.messageId);
      expect(new Set(messageIds).size).toBe(messageIds.length);
      
      consoleSpy.mockRestore();
    });
  });

  describe('6. Integration Compatibility', () => {
    it('should have tools compatible with worker integration', () => {
      const formDef = FormGenerator.getToolDefinition();
      const smsDef = SMSTool.getToolDefinition();

      // Check structure required for worker integration
      [formDef, smsDef].forEach(def => {
        expect(def).toHaveProperty('name');
        expect(def).toHaveProperty('description');
        expect(def).toHaveProperty('inputSchema');
        expect(def.inputSchema).toHaveProperty('type', 'object');
        expect(def.inputSchema).toHaveProperty('properties');
        expect(def.inputSchema).toHaveProperty('required');
        expect(Array.isArray(def.inputSchema.required)).toBe(true);
      });
    });

    it('should match expected tool names from worker configuration', () => {
      const formDef = FormGenerator.getToolDefinition();
      const smsDef = SMSTool.getToolDefinition();
      const smsFormLinkDef = SMSTool.getFormLinkToolDefinition();

      expect(formDef.name).toBe('FormGenerator_CreateForm');
      expect(smsDef.name).toBe('SMS_SendMessage');
      expect(smsFormLinkDef.name).toBe('SMS_SendFormLink');
      
      // Verify form link tool has correct parameters
      expect(smsFormLinkDef.inputSchema.required).toContain('phoneNumber');
      expect(smsFormLinkDef.inputSchema.required).toContain('formUrl');
      expect(smsFormLinkDef.inputSchema.required).toContain('formTitle');
      expect(smsFormLinkDef.inputSchema.required).not.toContain('businessName');
      expect(smsFormLinkDef.inputSchema.properties.businessName.default).toBe('Adventure Harmony');
    });
  });
});

describe('Form System Workflow Simulation', () => {
  it('should simulate complete form workflow', async () => {
    const formGenerator = new FormGenerator(mockSupabase);
    const smsTool = new SMSTool(mockSupabase);
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    try {
      // Step 1: Business creates form
      const formResult = await formGenerator.createForm({
        formTitle: 'Adventure Booking',
        formType: 'booking',
        fields: [
          { name: 'name', label: 'Full Name', type: 'text' as const, required: true },
          { name: 'email', label: 'Email', type: 'email' as const, required: true },
          { name: 'participants', label: 'Number of Participants', type: 'number' as const, required: true }
        ],
        originatingProfileId: 'business_123',
        customerPhone: '+1234567890'
      });

      expect(formResult.url).toBeTruthy();
      expect(formResult.formId).toBeTruthy();

      // Step 2: SMS sent to customer
      const smsResult = await smsTool.sendFormLink(
        '+1234567890',
        formResult.url,
        'Adventure Booking',
        'Mountain Adventures'
      );

      expect(smsResult.success).toBe(true);
      expect(smsResult.messageId).toBeTruthy();

      // Step 3: Verify SMS contains form URL
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(formResult.url)
      );

      console.log('✅ Complete workflow simulation passed!');
      
    } finally {
      consoleSpy.mockRestore();
    }
  });
});