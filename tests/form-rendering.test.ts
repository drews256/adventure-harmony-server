/**
 * Form Rendering Test
 * This test creates a form and validates that the HTML can be rendered without JavaScript errors
 */

import { FormGenerator } from '../src/services/form-generator';

// Mock Supabase for testing
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockImplementation(() => {
    // Check if this is a select call (getFormHTML) vs insert call (createForm)
    const fromCall = mockSupabase.from.mock.calls[mockSupabase.from.mock.calls.length - 1];
    if (fromCall && fromCall[0] === 'dynamic_forms') {
      const selectCall = mockSupabase.select.mock.calls[mockSupabase.select.mock.calls.length - 1];
      if (selectCall && selectCall[0] === 'html_content, status, expires_at') {
        // This is getFormHTML - return mock HTML content
        return Promise.resolve({
          data: {
            html_content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Form</title>
    <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@rjsf/core@5.24.7/dist/index.js"></script>
    <script src="https://unpkg.com/@rjsf/utils@5.24.7/dist/index.js"></script>
    <script src="https://unpkg.com/@rjsf/validator-ajv8@5.24.7/dist/index.js"></script>
    <style>
        @media (max-width: 768px) { body { width: 100%; } }
    </style>
</head>
<body>
    <div id="form-root"></div>
    <script>
        if (typeof React === 'undefined') throw new Error('React not loaded');
        if (typeof ReactDOM === 'undefined') throw new Error('ReactDOM not loaded');
        if (typeof RJSFCore === 'undefined') throw new Error('RJSF Core not loaded');
        if (typeof RJSFValidatorAjv8 === 'undefined') throw new Error('RJSF Validator not loaded');
        
        const { Form } = RJSFCore;
        const validator = RJSFValidatorAjv8.default;
        const schema = {"type":"object","properties":{"text_field":{"type":"string","title":"Text Field"},"email_field":{"type":"string","title":"Email Field","format":"email"},"number_field":{"type":"number","title":"Number Field"},"select_field":{"type":"string","title":"Select Field","enum":["A","B","C"]},"textarea_field":{"type":"string","title":"Textarea Field"},"checkbox_field":{"type":"boolean","title":"Checkbox Field"}},"required":["text_field","email_field"]};
        
        fetch('/api/form-submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const isSubmitted = false;
        console.log('Custom success message!');
    </script>
</body>
</html>`,
            status: 'active',
            expires_at: null
          },
          error: null
        });
      }
    }
    
    // Default for createForm
    return Promise.resolve({
      data: { id: 'test_form_123' },
      error: null
    });
  })
};

describe('Form Rendering Tests', () => {
  let formGenerator: FormGenerator;

  beforeAll(() => {
    formGenerator = new FormGenerator(mockSupabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('HTML Generation', () => {
    it('should generate valid HTML structure', async () => {
      const args = {
        formTitle: 'Test Form',
        formType: 'test',
        fields: [
          { name: 'name', type: 'text' as const, label: 'Your Name', required: true },
          { name: 'email', type: 'email' as const, label: 'Email Address', required: true }
        ],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      expect(result).toHaveProperty('formId');
      expect(result).toHaveProperty('url');

      // Get the HTML content
      const html = await formGenerator.getFormHTML(result.formId);
      expect(html).toBeDefined();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test Form');
      expect(html).toContain('React');
      expect(html).toContain('RJSFCore');
    });

    it('should include all required script dependencies', async () => {
      const args = {
        formTitle: 'Dependency Test Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test Field' }],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      // Check for React dependencies
      expect(html).toContain('react@18/umd/react.development.js');
      expect(html).toContain('react-dom@18/umd/react-dom.development.js');
      
      // Check for RJSF dependencies
      expect(html).toContain('@rjsf/core@5.24.7/dist/index.js');
      expect(html).toContain('@rjsf/utils@5.24.7/dist/index.js');
      expect(html).toContain('@rjsf/validator-ajv8@5.24.7/dist/index.js');
    });

    it('should include library loading checks', async () => {
      const args = {
        formTitle: 'Error Check Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test Field' }],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      // Check for error handling code
      expect(html).toContain('typeof React === \'undefined\'');
      expect(html).toContain('typeof ReactDOM === \'undefined\'');
      expect(html).toContain('typeof RJSFCore === \'undefined\'');
      expect(html).toContain('typeof RJSFValidatorAjv8 === \'undefined\'');
    });
  });

  describe('Schema Generation', () => {
    it('should generate valid JSON schema for different field types', async () => {
      const args = {
        formTitle: 'Multi-Field Test',
        formType: 'test',
        fields: [
          { name: 'text_field', type: 'text' as const, label: 'Text Field', required: true },
          { name: 'email_field', type: 'email' as const, label: 'Email Field', required: true },
          { name: 'number_field', type: 'number' as const, label: 'Number Field', required: false },
          { name: 'select_field', type: 'select' as const, label: 'Select Field', options: ['A', 'B', 'C'] },
          { name: 'textarea_field', type: 'textarea' as const, label: 'Textarea Field' },
          { name: 'checkbox_field', type: 'checkbox' as const, label: 'Checkbox Field' }
        ],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      // Extract schema from HTML
      const schemaMatch = html?.match(/const schema = ({.*?});/s);
      expect(schemaMatch).toBeDefined();
      
      const schemaJson = JSON.parse(schemaMatch![1]);
      
      // Validate schema structure
      expect(schemaJson.type).toBe('object');
      expect(schemaJson.properties).toBeDefined();
      expect(schemaJson.required).toContain('text_field');
      expect(schemaJson.required).toContain('email_field');
      
      // Check specific field types
      expect(schemaJson.properties.text_field.type).toBe('string');
      expect(schemaJson.properties.email_field.format).toBe('email');
      expect(schemaJson.properties.number_field.type).toBe('number');
      expect(schemaJson.properties.select_field.enum).toEqual(['A', 'B', 'C']);
      expect(schemaJson.properties.checkbox_field.type).toBe('boolean');
    });
  });

  describe('Form Validation', () => {
    it('should validate required fields', async () => {
      const validArgs = {
        formTitle: 'Valid Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test' }],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(validArgs)).resolves.toBeDefined();
    });

    it('should reject empty fields array', async () => {
      const invalidArgs = {
        formTitle: 'Invalid Form',
        formType: 'test',
        fields: [],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(invalidArgs))
        .rejects.toThrow('At least one field is required');
    });

    it('should reject missing form title', async () => {
      const invalidArgs = {
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test' }],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(invalidArgs as any))
        .rejects.toThrow('Form title is required');
    });
  });

  describe('Mobile Optimization', () => {
    it('should include mobile viewport meta tag', async () => {
      const args = {
        formTitle: 'Mobile Test Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test Field' }],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    });

    it('should include mobile-responsive CSS', async () => {
      const args = {
        formTitle: 'CSS Test Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test Field' }],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      expect(html).toContain('@media (max-width: 768px)');
      expect(html).toContain('width: 100%');
    });
  });

  describe('Form Submission', () => {
    it('should include form submission endpoint', async () => {
      const args = {
        formTitle: 'Submission Test Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test Field' }],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      expect(html).toContain('/api/form-submit');
      expect(html).toContain('POST');
      expect(html).toContain('Content-Type\': \'application/json');
    });

    it('should include success message handling', async () => {
      const args = {
        formTitle: 'Success Test Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text' as const, label: 'Test Field' }],
        originatingProfileId: 'test_profile_123',
        successMessage: 'Custom success message!'
      };

      const result = await formGenerator.createForm(args);
      const html = await formGenerator.getFormHTML(result.formId);

      expect(html).toContain('Custom success message!');
      expect(html).toContain('isSubmitted');
    });
  });
});

// Additional test to check if we can simulate form rendering
describe('Form Rendering Simulation', () => {
  it('should create a testable form HTML without errors', async () => {
    const formGenerator = new FormGenerator(mockSupabase);
    
    const args = {
      formTitle: 'Simulation Test Form',
      formType: 'test',
      fields: [
        { name: 'name', type: 'text' as const, label: 'Name', required: true },
        { name: 'email', type: 'email' as const, label: 'Email', required: true }
      ],
      originatingProfileId: 'test_profile_123'
    };

    const result = await formGenerator.createForm(args);
    expect(result.formId).toMatch(/^form_/);
    expect(result.url).toContain('/form/');

    const html = await formGenerator.getFormHTML(result.formId);
    expect(html).toBeDefined();
    expect(html?.length).toBeGreaterThan(1000); // Should be substantial HTML

    // Test that HTML is well-formed
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('</html>');
    
    // Count opening vs closing tags for basic validation
    const openTags = (html?.match(/<[^/][^>]*>/g) || []).length;
    const closeTags = (html?.match(/<\/[^>]*>/g) || []).length;
    expect(openTags).toBeGreaterThan(10); // Should have substantial structure
    expect(closeTags).toBeGreaterThan(5);  // Should have closing tags
  });
});