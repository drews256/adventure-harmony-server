export class FormRenderer {
  /**
   * Generate the form page HTML that loads form config dynamically
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
        
        .loading {
            text-align: center;
            padding: 3rem;
            color: var(--text-secondary);
        }
        
        .error {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #dc2626;
            padding: 1rem;
            border-radius: 8px;
            margin: 1rem;
        }
        
        .field-group {
            margin-bottom: 1.5rem;
        }
        
        label {
            display: block;
            font-weight: 600;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }
        
        input, select, textarea {
            width: 100%;
            padding: 0.75rem 1rem;
            border: 2px solid var(--border-color);
            border-radius: 8px;
            font-size: 1rem;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
            background: white;
            font-family: inherit;
        }
        
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }
        
        textarea {
            resize: vertical;
            min-height: 100px;
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .checkbox-group input {
            width: auto;
        }
        
        .help-text {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-top: 0.25rem;
        }
        
        .error-text {
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
        
        .spinner {
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
    <div id="root"></div>
    
    <script>
        const { useState, useEffect, createElement: h } = React;
        
        function FormApp() {
            const [formConfig, setFormConfig] = useState(null);
            const [formData, setFormData] = useState({});
            const [errors, setErrors] = useState({});
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
                        // Initialize form data with defaults
                        const initialData = {};
                        Object.keys(config.schema.properties).forEach(key => {
                            const field = config.schema.properties[key];
                            if (field.type === 'boolean') {
                                initialData[key] = false;
                            } else if (field.type === 'array') {
                                initialData[key] = [];
                            } else {
                                initialData[key] = '';
                            }
                        });
                        setFormData(initialData);
                        setLoading(false);
                    })
                    .catch(err => {
                        setError(err.message);
                        setLoading(false);
                    });
            }, [formId]);
            
            const validateField = (name, value) => {
                const field = formConfig.schema.properties[name];
                const required = formConfig.schema.required.includes(name);
                
                if (required && !value) {
                    return 'This field is required';
                }
                
                if (field.pattern && value) {
                    const regex = new RegExp(field.pattern);
                    if (!regex.test(value)) {
                        return field.patternMessage || 'Invalid format';
                    }
                }
                
                if (field.format === 'email' && value) {
                    const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
                    if (!emailRegex.test(value)) {
                        return 'Invalid email address';
                    }
                }
                
                if (field.minimum !== undefined && value < field.minimum) {
                    return \`Value must be at least \${field.minimum}\`;
                }
                
                if (field.maximum !== undefined && value > field.maximum) {
                    return \`Value must be at most \${field.maximum}\`;
                }
                
                return null;
            };
            
            const handleChange = (name, value) => {
                setFormData(prev => ({ ...prev, [name]: value }));
                const error = validateField(name, value);
                setErrors(prev => ({ ...prev, [name]: error }));
            };
            
            const handleSubmit = async (e) => {
                e.preventDefault();
                
                // Validate all fields
                const newErrors = {};
                Object.keys(formConfig.schema.properties).forEach(key => {
                    const error = validateField(key, formData[key]);
                    if (error) newErrors[key] = error;
                });
                
                if (Object.keys(newErrors).length > 0) {
                    setErrors(newErrors);
                    return;
                }
                
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
            
            const renderField = (name, field) => {
                const value = formData[name] || '';
                const error = errors[name];
                const uiSchema = formConfig.ui_schema[name] || {};
                
                let input;
                
                if (field.type === 'boolean') {
                    input = h('div', { className: 'checkbox-group' },
                        h('input', {
                            type: 'checkbox',
                            id: name,
                            checked: value,
                            onChange: (e) => handleChange(name, e.target.checked)
                        }),
                        h('label', { htmlFor: name }, field.title)
                    );
                } else if (field.enum) {
                    input = h('select', {
                        id: name,
                        value: value,
                        onChange: (e) => handleChange(name, e.target.value)
                    },
                        h('option', { value: '' }, 'Select...'),
                        field.enum.map(opt => h('option', { key: opt, value: opt }, opt))
                    );
                } else if (field.type === 'array' && field.items?.enum) {
                    input = h('div', null,
                        field.items.enum.map(opt => h('div', { key: opt, className: 'checkbox-group' },
                            h('input', {
                                type: 'checkbox',
                                id: \`\${name}-\${opt}\`,
                                checked: value.includes(opt),
                                onChange: (e) => {
                                    const newValue = e.target.checked
                                        ? [...value, opt]
                                        : value.filter(v => v !== opt);
                                    handleChange(name, newValue);
                                }
                            }),
                            h('label', { htmlFor: \`\${name}-\${opt}\` }, opt)
                        ))
                    );
                } else if (uiSchema['ui:widget'] === 'textarea') {
                    input = h('textarea', {
                        id: name,
                        value: value,
                        onChange: (e) => handleChange(name, e.target.value),
                        placeholder: uiSchema['ui:placeholder'],
                        rows: uiSchema['ui:options']?.rows || 4
                    });
                } else {
                    const inputType = field.format === 'date' ? 'date' 
                        : field.format === 'date-time' ? 'datetime-local'
                        : field.type === 'number' ? 'number'
                        : uiSchema['ui:widget'] || 'text';
                        
                    input = h('input', {
                        type: inputType,
                        id: name,
                        value: value,
                        onChange: (e) => handleChange(name, e.target.value),
                        placeholder: uiSchema['ui:placeholder']
                    });
                }
                
                return h('div', { key: name, className: 'field-group' },
                    field.type !== 'boolean' && h('label', { htmlFor: name }, 
                        field.title,
                        formConfig.schema.required.includes(name) && h('span', { style: { color: 'red' } }, ' *')
                    ),
                    input,
                    field.description && h('div', { className: 'help-text' }, field.description),
                    error && h('div', { className: 'error-text' }, error)
                );
            };
            
            if (loading) {
                return h('div', { className: 'form-container' },
                    h('div', { className: 'loading' }, 'Loading form...')
                );
            }
            
            if (error) {
                return h('div', { className: 'form-container' },
                    h('div', { className: 'error' }, error)
                );
            }
            
            if (submitted) {
                return h('div', { className: 'form-container' },
                    h('div', { className: 'success-message' },
                        h('h2', null, '✅ Success!'),
                        h('p', null, formConfig.success_message)
                    )
                );
            }
            
            return h('div', { className: 'form-container' },
                h('div', { className: 'form-header' },
                    h('h1', null, formConfig.form_title),
                    h('p', null, 'Please fill out the information below')
                ),
                h('div', { className: 'form-content' },
                    h('form', { onSubmit: handleSubmit },
                        Object.keys(formConfig.schema.properties).map(key => 
                            renderField(key, formConfig.schema.properties[key])
                        ),
                        h('button', {
                            type: 'submit',
                            className: 'submit-button',
                            disabled: submitting
                        }, submitting ? 
                            h('span', null, h('span', { className: 'spinner' }), ' Submitting...') 
                            : formConfig.submit_button_text
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