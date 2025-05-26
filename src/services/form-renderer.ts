export class FormRenderer {
  /**
   * Generate the form page HTML that loads form config dynamically with shadcn/ui styling
   */
  static generateFormPage(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Adventure Harmony Form</title>
    
    <!-- React -->
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    
    <!-- RJSF -->
    <script crossorigin src="https://unpkg.com/@rjsf/core@5.18.4/dist/core.umd.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/@rjsf/utils@5.18.4/dist/utils.umd.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/@rjsf/validator-ajv8@5.18.4/dist/validator-ajv8.umd.production.min.js"></script>
    
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        * {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    
    <script>
        const { useState, useEffect, createElement: h } = React;
        const Form = window.rjsf.default;
        const validator = window.validatorAjv8.default;
        
        // Utility function to combine classes
        const cn = (...classes) => classes.filter(Boolean).join(' ');
        
        // Custom shadcn-styled widgets
        const TextWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus, options, placeholder } = props;
          return h('input', {
            id,
            type: 'text',
            className: 'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value)),
            placeholder: placeholder || options?.placeholder
          });
        };
        
        const EmailWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
          return h('input', {
            id,
            type: 'email',
            className: 'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value)),
            placeholder: options?.placeholder
          });
        };
        
        const PasswordWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
          return h('input', {
            id,
            type: 'password',
            className: 'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value)),
            placeholder: options?.placeholder
          });
        };
        
        const NumberWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus, options, schema } = props;
          return h('input', {
            id,
            type: 'number',
            className: 'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value ? Number(e.target.value) : undefined),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value ? Number(e.target.value) : undefined)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value ? Number(e.target.value) : undefined)),
            placeholder: options?.placeholder,
            min: schema?.minimum,
            max: schema?.maximum,
            step: schema?.multipleOf
          });
        };
        
        const TextareaWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
          return h('textarea', {
            id,
            className: 'flex min-h-[80px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value)),
            placeholder: options?.placeholder,
            rows: options?.rows || 5
          });
        };
        
        const SelectWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus, options } = props;
          const { enumOptions } = options;
          
          return h('select', {
            id,
            className: 'flex h-10 w-full items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value))
          },
            h('option', { value: '' }, 'Select...'),
            enumOptions && enumOptions.map(({ value, label }) => 
              h('option', { key: value, value }, label)
            )
          );
        };
        
        const CheckboxWidget = (props) => {
          const { id, disabled, readonly, value, onChange, label, schema } = props;
          
          return h('div', { className: 'flex items-center space-x-2' },
            h('input', {
              id,
              type: 'checkbox',
              className: 'peer h-4 w-4 shrink-0 rounded-sm border border-slate-900 ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
              disabled: disabled || readonly,
              checked: value || false,
              onChange: (e) => onChange(e.target.checked)
            }),
            schema.title && h('label', {
              htmlFor: id,
              className: 'text-sm font-normal cursor-pointer'
            }, schema.title)
          );
        };
        
        const DateWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus } = props;
          return h('input', {
            id,
            type: 'date',
            className: 'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value))
          });
        };
        
        const DateTimeWidget = (props) => {
          const { id, disabled, readonly, value, onChange, onBlur, onFocus } = props;
          return h('input', {
            id,
            type: 'datetime-local',
            className: 'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            disabled: disabled || readonly,
            value: value || '',
            onChange: (e) => onChange(e.target.value),
            onBlur: onBlur && ((e) => onBlur(id, e.target.value)),
            onFocus: onFocus && ((e) => onFocus(id, e.target.value))
          });
        };
        
        const FieldTemplate = (props) => {
          const {
            id,
            label,
            required,
            disabled,
            readonly,
            errors,
            help,
            description,
            children,
          } = props;

          return h('div', { className: cn('mb-4', errors && errors.length > 0 && 'mb-6') },
            label && h('label', {
              htmlFor: id,
              className: 'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 mb-2 block'
            },
              label,
              required && h('span', { className: 'ml-1 text-red-500' }, '*')
            ),
            description && h('p', { className: 'text-sm text-slate-500 mb-2' }, description),
            children,
            errors && errors.length > 0 && h('p', { className: 'mt-1 text-sm text-red-600' }, errors),
            help && h('p', { className: 'mt-1 text-sm text-slate-500' }, help)
          );
        };
        
        // Create theme configuration
        const shadcnTheme = {
          widgets: {
            TextWidget,
            PasswordWidget,
            EmailWidget,
            NumberWidget,
            TextareaWidget,
            SelectWidget,
            CheckboxWidget,
            DateWidget,
            DateTimeWidget,
          },
          templates: {
            FieldTemplate,
          }
        };
        
        // Card components
        const Card = ({ children, className }) => 
            h('div', { 
                className: cn('rounded-lg border border-slate-200 bg-white text-slate-950 shadow-sm', className) 
            }, children);
            
        const CardHeader = ({ children }) => 
            h('div', { className: 'flex flex-col space-y-1.5 p-6' }, children);
            
        const CardTitle = ({ children }) => 
            h('h3', { className: 'text-2xl font-semibold leading-none tracking-tight' }, children);
            
        const CardDescription = ({ children }) => 
            h('p', { className: 'text-sm text-slate-500' }, children);
            
        const CardContent = ({ children, className }) => 
            h('div', { className: cn('p-6 pt-0', className) }, children);
        
        function FormApp() {
            const [formConfig, setFormConfig] = useState(null);
            const [formData, setFormData] = useState({});
            const [loading, setLoading] = useState(true);
            const [submitting, setSubmitting] = useState(false);
            const [submitted, setSubmitted] = useState(false);
            const [error, setError] = useState(null);
            
            // Get form ID from URL
            const formId = window.location.pathname.split('/').pop();
            
            useEffect(() => {
                // Fetch form configuration
                fetch(\`/api/form-config/\${formId}\`)
                    .then(res => {
                        if (!res.ok) throw new Error('Form not found');
                        return res.json();
                    })
                    .then(config => {
                        setFormConfig(config);
                        setLoading(false);
                    })
                    .catch(err => {
                        setError(err.message);
                        setLoading(false);
                    });
            }, [formId]);
            
            const handleSubmit = async ({ formData }, e) => {
                e.preventDefault();
                setSubmitting(true);
                
                try {
                    const response = await fetch('/api/form-submit', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ formId, data: formData })
                    });
                    
                    if (!response.ok) throw new Error('Submission failed');
                    setSubmitted(true);
                } catch (err) {
                    alert('There was an error submitting the form. Please try again.');
                } finally {
                    setSubmitting(false);
                }
            };
            
            if (loading) {
                return h('div', { className: 'min-h-screen bg-gray-50 flex items-center justify-center p-4' },
                    h(Card, { className: 'w-full max-w-2xl' },
                        h(CardContent, { className: 'p-8' },
                            h('div', { className: 'flex items-center justify-center' },
                                h('div', { className: 'animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900' }),
                                h('span', { className: 'ml-3 text-gray-600' }, 'Loading form...')
                            )
                        )
                    )
                );
            }
            
            if (error) {
                return h('div', { className: 'min-h-screen bg-gray-50 flex items-center justify-center p-4' },
                    h(Card, { className: 'w-full max-w-2xl' },
                        h(CardContent, { className: 'p-8' },
                            h('div', { className: 'bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded' }, error)
                        )
                    )
                );
            }
            
            if (submitted) {
                return h('div', { className: 'min-h-screen bg-gray-50 flex items-center justify-center p-4' },
                    h(Card, { className: 'w-full max-w-2xl' },
                        h(CardContent, { className: 'p-8 text-center' },
                            h('div', { className: 'mb-4' },
                                h('div', { className: 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100' },
                                    h('svg', { className: 'h-6 w-6 text-green-600', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                                        h('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M5 13l4 4L19 7' })
                                    )
                                )
                            ),
                            h('h2', { className: 'text-2xl font-bold text-gray-900 mb-2' }, 'Success!'),
                            h('p', { className: 'text-gray-600' }, formConfig?.success_message)
                        )
                    )
                );
            }
            
            if (!formConfig) return null;
            
            // Add submit button text to uiSchema
            const enhancedUiSchema = {
                ...formConfig.ui_schema,
                'ui:submitButtonOptions': {
                    submitText: formConfig.submit_button_text,
                    props: {
                        disabled: submitting,
                        className: 'w-full'
                    }
                }
            };
            
            return h('div', { className: 'min-h-screen bg-gray-50 py-8 px-4' },
                h('div', { className: 'max-w-2xl mx-auto' },
                    h(Card, null,
                        h(CardHeader, null,
                            h(CardTitle, null, formConfig.form_title),
                            h(CardDescription, null, 'Please fill out the information below')
                        ),
                        h(CardContent, null,
                            h(Form, {
                                schema: formConfig.schema,
                                uiSchema: enhancedUiSchema,
                                formData: formData,
                                onChange: ({ formData }) => setFormData(formData),
                                onSubmit: handleSubmit,
                                validator: validator,
                                ...shadcnTheme,
                                children: h('button', {
                                    type: 'submit',
                                    disabled: submitting,
                                    className: 'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-slate-900 text-slate-50 hover:bg-slate-900/90 h-10 px-4 py-2 w-full mt-4'
                                },
                                    submitting ? 
                                        h('span', { className: 'flex items-center justify-center' },
                                            h('span', { className: 'animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2' }),
                                            'Submitting...'
                                        ) 
                                        : formConfig.submit_button_text
                                )
                            })
                        )
                    )
                )
            );
        }
        
        ReactDOM.render(h(FormApp), document.getElementById('root'));
    </script>
</body>
</html>`;
  }
}