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

describe('Basic Unit Tests', () => {
  describe('FormGenerator', () => {
    let formGenerator: FormGenerator;

    beforeAll(() => {
      formGenerator = new FormGenerator(mockSupabase);
    });

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

    it('should validate required fields in tool definition', () => {
      const definition = FormGenerator.getToolDefinition();
      const properties = definition.inputSchema.properties;
      
      expect(properties.formTitle).toBeDefined();
      expect(properties.formType).toBeDefined();
      expect(properties.fields).toBeDefined();
      expect(properties.originatingProfileId).toBeDefined();
      
      // Check field schema structure
      expect(properties.fields.type).toBe('array');
      expect(properties.fields.items).toBeDefined();
      expect(properties.fields.items.properties.name).toBeDefined();
      expect(properties.fields.items.properties.label).toBeDefined();
      expect(properties.fields.items.properties.type).toBeDefined();
    });
  });

  describe('SMSTool', () => {
    let smsTool: SMSTool;

    beforeAll(() => {
      smsTool = new SMSTool(mockSupabase);
    });

    it('should have correct tool definition', () => {
      const definition = SMSTool.getToolDefinition();
      
      expect(definition.name).toBe('SMS_SendFormLink');
      expect(definition.description).toContain('Send form link via SMS');
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.required).toContain('phoneNumber');
      expect(definition.inputSchema.required).toContain('formUrl');
      expect(definition.inputSchema.required).toContain('formTitle');
      expect(definition.inputSchema.required).not.toContain('businessName');
    });

    it('should validate phone number formats', async () => {
      // Test invalid phone numbers
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
        expect(result.messageId).toMatch(/^sms_/);
        expect(result.error).toBeUndefined();
      }
    });

    it('should format form link messages correctly', async () => {
      // Spy on console.log to verify message content
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/abc123',
        'Booking Form',
        'Adventure Outfitters'
      );
      
      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'SMS sent (development mode):',
        expect.objectContaining({
          to: '+1234567890',
          message: 'Hi! Adventure Outfitters has sent you a form to fill out: "Booking Form". Please click here to complete it: https://example.com/form/abc123',
          from: 'Adventure Outfitters'
        })
      );
      
      consoleSpy.mockRestore();
    });

    it('should use default business name when not provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/abc123',
        'Contact Form'
      );
      
      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'SMS sent (development mode):',
        expect.objectContaining({
          message: expect.stringContaining('Adventure Harmony has sent you'),
          from: 'Adventure Harmony'
        })
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('Tool Integration Compatibility', () => {
    it('should have compatible tool schemas for worker integration', () => {
      const formDef = FormGenerator.getToolDefinition();
      const smsDef = SMSTool.getToolDefinition();
      
      // Both tools should have the required structure for worker integration
      expect(formDef).toHaveProperty('name');
      expect(formDef).toHaveProperty('description');
      expect(formDef).toHaveProperty('inputSchema');
      
      expect(smsDef).toHaveProperty('name');
      expect(smsDef).toHaveProperty('description');
      expect(smsDef).toHaveProperty('inputSchema');
      
      // Input schemas should be valid JSON schemas
      expect(formDef.inputSchema.type).toBe('object');
      expect(formDef.inputSchema.properties).toBeDefined();
      expect(formDef.inputSchema.required).toBeInstanceOf(Array);
      
      expect(smsDef.inputSchema.type).toBe('object');
      expect(smsDef.inputSchema.properties).toBeDefined();
      expect(smsDef.inputSchema.required).toBeInstanceOf(Array);
    });

    it('should have unique tool names', () => {
      const formDef = FormGenerator.getToolDefinition();
      const smsDef = SMSTool.getToolDefinition();
      
      expect(formDef.name).not.toBe(smsDef.name);
      expect(formDef.name).toMatch(/^FormGenerator_/);
      expect(smsDef.name).toMatch(/^SMS_/);
    });
  });
});