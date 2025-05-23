import { MCPTool } from './goguide-api';

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'date' | 'datetime' | 'number' | 'select' | 'multiselect' | 'textarea' | 'checkbox';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

export interface FormGeneratorArgs {
  formType: string;
  formTitle: string;
  fields: FormField[];
  customerPhone?: string;
  customerName?: string;
  context?: Record<string, any>;
  expiresInHours?: number;
  submitButtonText?: string;
  successMessage?: string;
  
  // Context preservation
  originatingProfileId: string;
  originatingMessageId?: string;
  conversationThreadId?: string;
}

/**
 * Form generator tool that creates mobile-first React JSON Schema forms
 */
export class FormGenerator {
  private supabase;
  
  constructor(supabase: any) {
    this.supabase = supabase;
  }

  /**
   * Convert our simple field format to JSON Schema format
   */
  private generateJsonSchema(fields: FormField[]): any {
    const properties: any = {};
    const required: string[] = [];

    for (const field of fields) {
      let fieldSchema: any = {
        title: field.label,
        description: field.description
      };

      switch (field.type) {
        case 'text':
        case 'email':
        case 'phone':
          fieldSchema.type = 'string';
          if (field.type === 'email') fieldSchema.format = 'email';
          if (field.type === 'phone') fieldSchema.pattern = '^[+]?[1-9]?[0-9]{7,15}$';
          break;
        case 'textarea':
          fieldSchema.type = 'string';
          break;
        case 'number':
          fieldSchema.type = 'number';
          if (field.validation?.min !== undefined) fieldSchema.minimum = field.validation.min;
          if (field.validation?.max !== undefined) fieldSchema.maximum = field.validation.max;
          break;
        case 'date':
          fieldSchema.type = 'string';
          fieldSchema.format = 'date';
          break;
        case 'datetime':
          fieldSchema.type = 'string';
          fieldSchema.format = 'date-time';
          break;
        case 'select':
          fieldSchema.type = 'string';
          fieldSchema.enum = field.options || [];
          break;
        case 'multiselect':
          fieldSchema.type = 'array';
          fieldSchema.items = {
            type: 'string',
            enum: field.options || []
          };
          fieldSchema.uniqueItems = true;
          break;
        case 'checkbox':
          fieldSchema.type = 'boolean';
          break;
      }

      if (field.validation?.pattern) {
        fieldSchema.pattern = field.validation.pattern;
      }

      properties[field.name] = fieldSchema;

      if (field.required) {
        required.push(field.name);
      }
    }

    return {
      type: 'object',
      properties,
      required
    };
  }

  /**
   * Generate UI Schema for better mobile rendering
   */
  private generateUiSchema(fields: FormField[]): any {
    const uiSchema: any = {};

    for (const field of fields) {
      const fieldUi: any = {};

      switch (field.type) {
        case 'textarea':
          fieldUi['ui:widget'] = 'textarea';
          fieldUi['ui:options'] = { rows: 4 };
          break;
        case 'phone':
          fieldUi['ui:widget'] = 'tel';
          break;
        case 'email':
          fieldUi['ui:widget'] = 'email';
          break;
        case 'date':
          fieldUi['ui:widget'] = 'date';
          break;
        case 'datetime':
          fieldUi['ui:widget'] = 'datetime';
          break;
        case 'multiselect':
          fieldUi['ui:widget'] = 'checkboxes';
          break;
      }

      if (field.placeholder) {
        fieldUi['ui:placeholder'] = field.placeholder;
      }

      if (Object.keys(fieldUi).length > 0) {
        uiSchema[field.name] = fieldUi;
      }
    }

    return uiSchema;
  }

  /**
   * Generate mobile-optimized React form HTML
   */
  private generateFormHTML(
    formId: string,
    formTitle: string,
    schema: any,
    uiSchema: any,
    submitButtonText: string = 'Submit',
    successMessage: string = 'Thank you! Your form has been submitted.'
  ): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(formTitle)}</title>
    
    <!-- React and React JSON Schema Form -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@rjsf/core@5.24.7/dist/index.js"></script>
    <script src="https://unpkg.com/@rjsf/utils@5.24.7/dist/index.js"></script>
    <script src="https://unpkg.com/@rjsf/validator-ajv8@5.24.7/dist/index.js"></script>
    
    <style>
        :root {
            --primary-color: #2563eb;
            --primary-dark: #1d4ed8;
            --secondary-color: #f1f5f9;
            --success-color: #10b981;
            --error-color: #ef4444;
            --text-primary: #0f172a;
            --text-secondary: #64748b;
            --border-color: #e2e8f0;
            --shadow-light: 0 1px 3px rgba(0, 0, 0, 0.05);
            --shadow-medium: 0 4px 6px rgba(0, 0, 0, 0.07);
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            color: var(--text-primary);
            line-height: 1.6;
            min-height: 100vh;
            padding: 1rem;
        }
        
        .form-container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            border-radius: 16px;
            box-shadow: var(--shadow-medium);
            overflow: hidden;
            animation: slideUp 0.6s ease-out;
        }
        
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .form-header {
            background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-dark) 100%);
            color: white;
            padding: 2rem;
            text-align: center;
        }
        
        .form-header h1 {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }
        
        .form-content {
            padding: 2rem;
        }
        
        /* React JSON Schema Form Styling */
        .rjsf {
            font-family: inherit;
        }
        
        .rjsf fieldset {
            border: none;
            margin: 0;
            padding: 0;
        }
        
        .rjsf legend {
            display: none;
        }
        
        .rjsf .form-group {
            margin-bottom: 1.5rem;
        }
        
        .rjsf label {
            display: block;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }
        
        .rjsf input,
        .rjsf select,
        .rjsf textarea {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 2px solid var(--border-color);
            border-radius: 8px;
            font-size: 1rem;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            background: white;
        }
        
        .rjsf input:focus,
        .rjsf select:focus,
        .rjsf textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
        
        .rjsf textarea {
            resize: vertical;
            min-height: 100px;
        }
        
        .rjsf .checkbox {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .rjsf .checkbox input {
            width: auto;
        }
        
        .rjsf .help-block {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
        }
        
        .rjsf .text-danger {
            color: var(--error-color);
            font-size: 0.875rem;
            margin-top: 0.25rem;
        }
        
        .submit-button {
            width: 100%;
            padding: 1rem;
            background: var(--primary-color);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-top: 1rem;
        }
        
        .submit-button:hover {
            background: var(--primary-dark);
            transform: translateY(-1px);
            box-shadow: var(--shadow-medium);
        }
        
        .submit-button:disabled {
            background: var(--text-secondary);
            cursor: not-allowed;
            transform: none;
        }
        
        .success-message {
            background: var(--success-color);
            color: white;
            padding: 2rem;
            text-align: center;
            border-radius: 8px;
            margin: 2rem 0;
            animation: slideUp 0.6s ease-out;
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        @media (max-width: 768px) {
            body {
                padding: 0.5rem;
            }
            
            .form-header {
                padding: 1.5rem;
            }
            
            .form-content {
                padding: 1.5rem;
            }
            
            .form-header h1 {
                font-size: 1.25rem;
            }
        }
    </style>
</head>
<body>
    <div class="form-container">
        <div class="form-header">
            <h1>${this.escapeHtml(formTitle)}</h1>
            <p>Please fill out the information below</p>
        </div>
        
        <div class="form-content">
            <div id="form-root"></div>
        </div>
    </div>
    
    <script>
        // Check if all required libraries are loaded
        if (typeof React === 'undefined') {
            document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: React not loaded</div>';
            throw new Error('React not loaded');
        }
        if (typeof ReactDOM === 'undefined') {
            document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: ReactDOM not loaded</div>';
            throw new Error('ReactDOM not loaded');
        }
        if (typeof RJSFCore === 'undefined') {
            document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: RJSF Core not loaded</div>';
            throw new Error('RJSF Core not loaded');
        }
        if (typeof RJSFValidatorAjv8 === 'undefined') {
            document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: RJSF Validator not loaded</div>';
            throw new Error('RJSF Validator not loaded');
        }

        const { Form } = RJSFCore;
        const validator = RJSFValidatorAjv8.default;
        
        const schema = ${JSON.stringify(schema)};
        const uiSchema = ${JSON.stringify(uiSchema)};
        const formId = '${formId}';
        
        function FormComponent() {
            const [isSubmitting, setIsSubmitting] = React.useState(false);
            const [isSubmitted, setIsSubmitted] = React.useState(false);
            
            const handleSubmit = async (data) => {
                setIsSubmitting(true);
                
                try {
                    const response = await fetch('/api/form-submit', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            formId: formId,
                            data: data.formData
                        })
                    });
                    
                    if (response.ok) {
                        setIsSubmitted(true);
                    } else {
                        throw new Error('Submission failed');
                    }
                } catch (error) {
                    alert('There was an error submitting the form. Please try again.');
                } finally {
                    setIsSubmitting(false);
                }
            };
            
            if (isSubmitted) {
                return React.createElement('div', { className: 'success-message' },
                    React.createElement('h2', null, '✅ Success!'),
                    React.createElement('p', null, '${this.escapeHtml(successMessage)}')
                );
            }
            
            return React.createElement(Form, {
                schema: schema,
                uiSchema: uiSchema,
                validator: validator,
                onSubmit: handleSubmit,
                children: React.createElement('button', {
                    type: 'submit',
                    className: 'submit-button',
                    disabled: isSubmitting
                }, isSubmitting ? 
                    React.createElement('span', null,
                        React.createElement('span', { className: 'loading' }),
                        ' Submitting...'
                    ) : '${this.escapeHtml(submitButtonText)}'
                )
            });
        }
        
        ReactDOM.render(
            React.createElement(FormComponent),
            document.getElementById('form-root')
        );
    </script>
</body>
</html>`;
  }

  /**
   * Escape HTML for safe rendering
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Generate conversation thread ID if not provided
   */
  private generateThreadId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  }

  /**
   * Create a dynamic form and return hosted link
   */
  async createForm(args: FormGeneratorArgs): Promise<{ url: string; formId: string; expiresAt?: string }> {
    try {
      // Validate input arguments
      if (!args.fields || args.fields.length === 0) {
        throw new Error('At least one field is required to create a form');
      }
      
      if (!args.formTitle || args.formTitle.trim() === '') {
        throw new Error('Form title is required');
      }
      
      if (!args.formType || args.formType.trim() === '') {
        throw new Error('Form type is required');
      }
      
      if (!args.originatingProfileId || args.originatingProfileId.trim() === '') {
        throw new Error('Originating profile ID is required');
      }
      
      // Generate unique form ID
      const formId = `form_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      
      // Generate thread ID if not provided
      const threadId = args.conversationThreadId || this.generateThreadId();
      
      // Calculate expiration
      const expiresAt = args.expiresInHours ? 
        new Date(Date.now() + (args.expiresInHours * 60 * 60 * 1000)).toISOString() : 
        null;
      
      // Generate JSON schemas
      const schema = this.generateJsonSchema(args.fields);
      const uiSchema = this.generateUiSchema(args.fields);
      
      // Generate HTML
      const html = this.generateFormHTML(
        formId,
        args.formTitle,
        schema,
        uiSchema,
        args.submitButtonText,
        args.successMessage
      );
      
      // Store form in database
      const { error } = await this.supabase
        .from('dynamic_forms')
        .insert({
          id: formId,
          originating_profile_id: args.originatingProfileId,
          originating_message_id: args.originatingMessageId,
          conversation_thread_id: threadId,
          form_type: args.formType,
          form_title: args.formTitle,
          schema,
          ui_schema: uiSchema,
          context: args.context || {},
          html_content: html,
          customer_phone: args.customerPhone,
          customer_name: args.customerName,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      
      if (error) {
        throw new Error(`Failed to store form: ${error.message}`);
      }
      
      // Return the hosted URL
      const baseUrl = process.env.BASE_URL || 'https://adventure-harmony-09bcd11c3365.herokuapp.com';
      return {
        url: `${baseUrl}/form/${formId}`,
        formId,
        expiresAt: expiresAt || undefined
      };
      
    } catch (error) {
      throw new Error(`Form creation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get form HTML by ID
   */
  async getFormHTML(formId: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase
        .from('dynamic_forms')
        .select('html_content, status, expires_at')
        .eq('id', formId)
        .single();
      
      if (error || !data) {
        return null;
      }
      
      // Check if form is expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        return null;
      }
      
      // Check if form is still active
      if (data.status !== 'active') {
        return null;
      }
      
      return data.html_content;
    } catch (error) {
      console.error('Error fetching form HTML:', error);
      return null;
    }
  }

  /**
   * Get MCP tool definition
   */
  static getToolDefinition(): MCPTool {
    return {
      name: 'FormGenerator_CreateForm',
      description: 'Creates a mobile-optimized React form using JSON Schema that customers can fill out via a link',
      inputSchema: {
        type: 'object',
        properties: {
          formType: {
            type: 'string',
            description: 'Type of form (e.g., "booking", "inquiry", "feedback")'
          },
          formTitle: {
            type: 'string',
            description: 'Title displayed at the top of the form'
          },
          fields: {
            type: 'array',
            description: 'Array of form fields to include',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field name/ID' },
                label: { type: 'string', description: 'Label shown to user' },
                type: { 
                  type: 'string', 
                  enum: ['text', 'email', 'phone', 'date', 'datetime', 'number', 'select', 'multiselect', 'textarea', 'checkbox'],
                  description: 'Field input type'
                },
                required: { type: 'boolean', description: 'Whether field is required' },
                options: { 
                  type: 'array', 
                  items: { type: 'string' },
                  description: 'Options for select/multiselect fields'
                },
                placeholder: { type: 'string', description: 'Placeholder text' },
                description: { type: 'string', description: 'Help text shown below field' }
              },
              required: ['name', 'label', 'type']
            }
          },
          customerPhone: {
            type: 'string',
            description: 'Phone number of customer who will fill the form'
          },
          customerName: {
            type: 'string',
            description: 'Name of customer who will fill the form'
          },
          context: {
            type: 'object',
            description: 'Additional context to store with the form'
          },
          expiresInHours: {
            type: 'number',
            description: 'How many hours until form expires (default: no expiration)'
          },
          submitButtonText: {
            type: 'string',
            description: 'Text for submit button (default: "Submit")'
          },
          successMessage: {
            type: 'string',
            description: 'Message shown after successful submission'
          },
          originatingProfileId: {
            type: 'string',
            description: 'Profile ID of the business owner who created this form'
          },
          originatingMessageId: {
            type: 'string',
            description: 'Message ID that triggered this form creation'
          },
          conversationThreadId: {
            type: 'string',
            description: 'Conversation thread to continue when form is submitted'
          }
        },
        required: ['formType', 'formTitle', 'fields', 'originatingProfileId']
      }
    };
  }
}