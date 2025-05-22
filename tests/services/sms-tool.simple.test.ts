import { SMSTool } from '../../src/services/sms-tool';
import { testSupabase, cleanupTestData } from '../helpers/database';

describe('SMSTool', () => {
  let smsTool: SMSTool;

  beforeAll(() => {
    smsTool = new SMSTool(testSupabase);
  });

  afterEach(async () => {
    await cleanupTestData();
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
        expect(result.messageId).toMatch(/^sms_/);
      }
    });

    it('should handle missing fromName gracefully', async () => {
      const result = await smsTool.sendSMS({
        to: '+1234567890',
        message: 'Test message'
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
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
      expect(result.messageId).toMatch(/^sms_/);
    });

    it('should use default business name when not provided', async () => {
      const result = await smsTool.sendFormLink(
        '+1234567890',
        'https://example.com/form/123',
        'Contact Form'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeTruthy();
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
  });

  describe('getToolDefinition', () => {
    it('should return valid tool definition', () => {
      const definition = SMSTool.getToolDefinition();

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

    it('should have businessName as optional parameter', () => {
      const definition = SMSTool.getToolDefinition();
      
      expect(definition.inputSchema.required).not.toContain('businessName');
      expect(definition.inputSchema.properties.businessName).toHaveProperty('default', 'Adventure Harmony');
    });
  });
});