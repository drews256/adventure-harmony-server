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
          { name: 'name', type: 'text' as const, label: 'Full Name', required: true },
          { name: 'email', type: 'email' as const, label: 'Email', required: true }
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

      expect(form.schema).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Full Name' },
          email: { type: 'string', title: 'Email', format: 'email' }
        },
        required: ['name', 'email']
      });
    });

    it('should generate valid HTML content', async () => {
      const args = {
        formTitle: 'Simple Form',
        formType: 'contact',
        fields: [
          { name: 'message', type: 'textarea' as const, label: 'Message' }
        ],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);

      // Get form from database
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('html_content')
        .eq('id', result.formId)
        .single();

      expect(form?.html_content).toContain('<!DOCTYPE html>');
      expect(form?.html_content).toContain('React');
      expect(form?.html_content).toContain('Simple Form');
      expect(form?.html_content).toContain('/api/form-submit');
    });

    it('should handle optional expiration date', async () => {
      const args = {
        formTitle: 'Expiring Form',
        formType: 'booking',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        expiresInHours: 24,
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);

      expect(result).toHaveProperty('expiresAt');
      expect(result.expiresAt).toBeDefined();

      // Verify in database
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('expires_at')
        .eq('id', result.formId)
        .single();

      expect(form?.expires_at).toBeDefined();
    });

    it('should handle different field types correctly', async () => {
      const args = {
        formTitle: 'Multi-Field Form',
        formType: 'survey',
        fields: [
          { name: 'age', type: 'number' as const, label: 'Age' },
          { name: 'terms', type: 'checkbox' as const, label: 'Accept Terms' },
          { name: 'message', type: 'textarea' as const, label: 'Message' },
          { name: 'date', type: 'date' as const, label: 'Preferred Date' },
          { name: 'category', type: 'select' as const, label: 'Category', options: ['A', 'B', 'C'] }
        ],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      
      // Get form from database to check schema
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('schema')
        .eq('id', result.formId)
        .single();

      expect(form?.schema.properties).toEqual({
        age: { type: 'number', title: 'Age' },
        terms: { type: 'boolean', title: 'Accept Terms' },
        message: { type: 'string', title: 'Message' },
        date: { type: 'string', title: 'Preferred Date', format: 'date' },
        category: { type: 'string', title: 'Category', enum: ['A', 'B', 'C'] }
      });
    });

    it('should validate required fields', async () => {
      const argsWithoutTitle = {
        formType: 'booking',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(argsWithoutTitle as any))
        .rejects.toThrow('Form title is required');
    });

    it('should validate required fields array', async () => {
      const argsWithoutFields = {
        formTitle: 'Test Form',
        formType: 'booking',
        fields: [],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(argsWithoutFields))
        .rejects.toThrow('At least one field is required');
    });

    it('should validate required profile ID', async () => {
      const argsWithoutProfileId = {
        formTitle: 'Test Form',
        formType: 'booking',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }]
      };

      await expect(formGenerator.createForm(argsWithoutProfileId as any))
        .rejects.toThrow('Originating profile ID is required');
    });
  });

  describe('getFormHTML', () => {
    it('should return HTML for active form', async () => {
      // First create a form
      const args = {
        formTitle: 'Test Form',
        formType: 'contact',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        originatingProfileId: 'test_profile_123'
      };

      const { formId } = await formGenerator.createForm(args);
      
      // Then retrieve its HTML
      const html = await formGenerator.getFormHTML(formId);
      
      expect(html).toBeDefined();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test Form');
    });

    it('should return null for non-existent form', async () => {
      const html = await formGenerator.getFormHTML('non_existent_form');
      expect(html).toBeNull();
    });
  });

  describe('getToolDefinition', () => {
    it('should return valid tool definition', () => {
      const definition = FormGenerator.getToolDefinition();

      expect(definition).toMatchObject({
        name: 'FormGenerator_CreateForm',
        description: expect.stringContaining('mobile-optimized'),
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