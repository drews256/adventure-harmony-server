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

  describe('generateJsonSchema', () => {
    it('should generate valid JSON schema from simple fields', () => {
      const fields = [
        { name: 'firstName', type: 'text', title: 'First Name', required: true },
        { name: 'email', type: 'email', title: 'Email Address', required: true },
        { name: 'phone', type: 'tel', title: 'Phone Number', required: false }
      ];

      const schema = formGenerator.generateJsonSchema(fields);

      expect(schema).toEqual({
        type: 'object',
        properties: {
          firstName: { type: 'string', title: 'First Name' },
          email: { type: 'string', title: 'Email Address', format: 'email' },
          phone: { type: 'string', title: 'Phone Number' }
        },
        required: ['firstName', 'email']
      });
    });

    it('should handle different field types correctly', () => {
      const fields = [
        { name: 'age', type: 'number', title: 'Age' },
        { name: 'terms', type: 'checkbox', title: 'Accept Terms' },
        { name: 'message', type: 'textarea', title: 'Message' },
        { name: 'date', type: 'date', title: 'Preferred Date' }
      ];

      const schema = formGenerator.generateJsonSchema(fields);

      expect(schema.properties).toEqual({
        age: { type: 'number', title: 'Age' },
        terms: { type: 'boolean', title: 'Accept Terms' },
        message: { type: 'string', title: 'Message' },
        date: { type: 'string', title: 'Preferred Date', format: 'date' }
      });
    });
  });

  describe('generateUiSchema', () => {
    it('should generate UI schema for different field types', () => {
      const fields = [
        { name: 'message', type: 'textarea', title: 'Message' },
        { name: 'phone', type: 'tel', title: 'Phone' },
        { name: 'password', type: 'password', title: 'Password' }
      ];

      const uiSchema = formGenerator.generateUiSchema(fields);

      expect(uiSchema).toEqual({
        message: { 'ui:widget': 'textarea' },
        phone: { 'ui:inputType': 'tel' },
        password: { 'ui:widget': 'password' }
      });
    });

    it('should include help text and placeholders', () => {
      const fields = [
        { 
          name: 'email', 
          type: 'email', 
          title: 'Email',
          placeholder: 'Enter your email',
          help: 'We will never share your email'
        }
      ];

      const uiSchema = formGenerator.generateUiSchema(fields);

      expect(uiSchema.email).toEqual({
        'ui:placeholder': 'Enter your email',
        'ui:help': 'We will never share your email'
      });
    });
  });

  describe('createForm', () => {
    it('should create a form and return URL and form ID', async () => {
      const args = {
        formTitle: 'Test Booking Form',
        formType: 'booking',
        fields: [
          { name: 'name', type: 'text', title: 'Full Name', required: true },
          { name: 'email', type: 'email', title: 'Email', required: true }
        ],
        customerPhone: '+1234567890',
        context: {
          profileId: 'test_profile_123',
          messageId: 'test_msg_123'
        }
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
          { name: 'message', type: 'textarea', title: 'Message' }
        ]
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
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      const args = {
        formTitle: 'Expiring Form',
        formType: 'booking',
        fields: [{ name: 'name', type: 'text', title: 'Name' }],
        expiresAt: expiresAt.toISOString()
      };

      const result = await formGenerator.createForm(args);

      expect(result).toHaveProperty('expiresAt');
      expect(new Date(result.expiresAt!)).toEqual(expiresAt);

      // Verify in database
      const { data: form } = await testSupabase
        .from('dynamic_forms')
        .select('expires_at')
        .eq('id', result.formId)
        .single();

      expect(new Date(form?.expires_at)).toEqual(expiresAt);
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
            fields: expect.any(Object)
          }),
          required: expect.arrayContaining(['formTitle', 'formType', 'fields'])
        }
      });
    });
  });
});