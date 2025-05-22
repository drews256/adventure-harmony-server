import { FormGenerator } from '../../src/services/form-generator';
import { testSupabase, cleanupTestData } from '../helpers/database';

describe('FormGenerator', () => {
  let formGenerator: FormGenerator;

  beforeAll(async () => {
    formGenerator = new FormGenerator(testSupabase);
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('createForm', () => {
    it('should create a form and return URL and form ID', async () => {
      const args = {
        formTitle: 'Test Booking Form',
        formType: 'booking',
        fields: [
          { name: 'name', label: 'Full Name', type: 'text' as const, required: true },
          { name: 'email', label: 'Email', type: 'email' as const, required: true }
        ],
        customerPhone: '+1234567890',
        originatingProfileId: 'test_profile_123',
        originatingMessageId: 'test_msg_123'
      };

      const result = await formGenerator.createForm(args);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('formId');
      expect(result.url).toContain('form');
      expect(result.formId).toMatch(/^form_/);

      // Verify form was stored in database
      const { data: form, error } = await testSupabase
        .from('dynamic_forms')
        .select('*')
        .eq('id', result.formId)
        .single();

      expect(error).toBeNull();
      expect(form).toMatchObject({
        form_type: 'booking',
        form_title: 'Test Booking Form',
        customer_phone: '+1234567890',
        originating_profile_id: 'test_profile_123',
        status: 'active'
      });

      expect(form.schema).toHaveProperty('type', 'object');
      expect(form.schema).toHaveProperty('properties');
      expect(form.schema.properties).toHaveProperty('name');
      expect(form.schema.properties).toHaveProperty('email');
      expect(form.schema.required).toContain('name');
      expect(form.schema.required).toContain('email');
    });

    it('should generate valid HTML content', async () => {
      const args = {
        formTitle: 'Simple Form',
        formType: 'contact',
        fields: [
          { name: 'message', label: 'Message', type: 'textarea' as const }
        ],
        originatingProfileId: 'test_profile_simple'
      };

      const result = await formGenerator.createForm(args);

      // Get form from database
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('html_content')
        .eq('id', result.formId)
        .single();

      expect(form?.html_content).toContain('<!DOCTYPE html>');
      expect(form?.html_content).toContain('React JSON Schema Form');
      expect(form?.html_content).toContain('Simple Form');
      expect(form?.html_content).toContain('/api/form-submit');
    });

    it('should handle optional expiration date', async () => {
      const args = {
        formTitle: 'Expiring Form',
        formType: 'booking',
        fields: [{ name: 'name', label: 'Name', type: 'text' as const }],
        originatingProfileId: 'test_profile_expire',
        expiresInHours: 24
      };

      const result = await formGenerator.createForm(args);

      expect(result).toHaveProperty('expiresAt');
      expect(result.expiresAt).toBeTruthy();

      // Verify in database
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('expires_at')
        .eq('id', result.formId)
        .single();

      expect(form?.expires_at).toBeTruthy();
      // Should expire approximately 24 hours from now
      const expiryTime = new Date(form?.expires_at);
      const expectedTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const timeDiff = Math.abs(expiryTime.getTime() - expectedTime.getTime());
      expect(timeDiff).toBeLessThan(60000); // Within 1 minute
    });

    it('should handle different field types', async () => {
      const args = {
        formTitle: 'Complex Form',
        formType: 'application',
        fields: [
          { name: 'age', label: 'Age', type: 'number' as const },
          { name: 'terms', label: 'Accept Terms', type: 'checkbox' as const },
          { name: 'message', label: 'Message', type: 'textarea' as const },
          { name: 'date', label: 'Preferred Date', type: 'date' as const },
          { name: 'phone', label: 'Phone', type: 'phone' as const }
        ],
        originatingProfileId: 'test_profile_complex'
      };

      const result = await formGenerator.createForm(args);

      // Verify form was created
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('schema')
        .eq('id', result.formId)
        .single();

      expect(form?.schema.properties.age.type).toBe('number');
      expect(form?.schema.properties.terms.type).toBe('boolean');
      expect(form?.schema.properties.message.type).toBe('string');
      expect(form?.schema.properties.date.type).toBe('string');
      expect(form?.schema.properties.phone.type).toBe('string');
    });
  });

  describe('getToolDefinition', () => {
    it('should return valid tool definition', () => {
      const definition = FormGenerator.getToolDefinition();

      expect(definition).toMatchObject({
        name: 'FormGenerator_CreateForm',
        description: expect.stringContaining('Generate mobile-optimized forms'),
        inputSchema: {
          type: 'object',
          properties: expect.objectContaining({
            formTitle: expect.any(Object),
            formType: expect.any(Object),
            fields: expect.any(Object),
            originatingProfileId: expect.any(Object)
          }),
          required: expect.arrayContaining(['formTitle', 'formType', 'fields', 'originatingProfileId'])
        }
      });
    });
  });
});