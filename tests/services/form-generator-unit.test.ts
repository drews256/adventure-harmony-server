import { FormGenerator } from '../../src/services/form-generator';

describe('FormGenerator Unit Tests', () => {
  let formGenerator: FormGenerator;
  let mockSupabase: any;

  beforeAll(() => {
    // Create a mock Supabase client for unit testing
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ 
        data: null, 
        error: null 
      })
    };
    
    formGenerator = new FormGenerator(mockSupabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('input validation', () => {
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

    it('should validate form title', async () => {
      const argsWithoutTitle = {
        formType: 'booking',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(argsWithoutTitle as any))
        .rejects.toThrow('Form title is required');
    });

    it('should validate form type', async () => {
      const argsWithoutType = {
        formTitle: 'Test Form',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(argsWithoutType as any))
        .rejects.toThrow('Form type is required');
    });
  });

  describe('createForm with mocked database', () => {
    it('should create form and return URL when database succeeds', async () => {
      // Mock successful database insert
      mockSupabase.single.mockResolvedValueOnce({
        data: { id: 'test_form_123' },
        error: null
      });

      const args = {
        formTitle: 'Test Form',
        formType: 'booking',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        originatingProfileId: 'test_profile_123'
      };

      const result = await formGenerator.createForm(args);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('formId');
      expect(result.url).toContain('form');
      expect(result.formId).toMatch(/^form_/);
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      mockSupabase.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database connection failed' }
      });

      const args = {
        formTitle: 'Test Form',
        formType: 'booking',
        fields: [{ name: 'name', type: 'text' as const, label: 'Name' }],
        originatingProfileId: 'test_profile_123'
      };

      await expect(formGenerator.createForm(args))
        .rejects.toThrow('Form creation failed: Failed to store form: Database connection failed');
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

    it('should have correct field schema', () => {
      const definition = FormGenerator.getToolDefinition();
      const fieldsSchema = definition.inputSchema.properties.fields;

      expect(fieldsSchema).toMatchObject({
        type: 'array',
        items: {
          type: 'object',
          properties: expect.objectContaining({
            name: expect.any(Object),
            label: expect.any(Object),
            type: expect.any(Object)
          }),
          required: expect.arrayContaining(['name', 'label', 'type'])
        }
      });
    });
  });
});