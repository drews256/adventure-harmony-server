import React from 'react';
import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';
import { RJSFSchema, UiSchema } from '@rjsf/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { shadcnTheme } from '../components/rjsf-shadcn-theme';

interface FormConfig {
  form_id: string;
  form_title: string;
  schema: RJSFSchema;
  ui_schema: UiSchema;
  submit_button_text: string;
  success_message: string;
}

interface FormAppProps {
  formId: string;
}

export const FormApp: React.FC<FormAppProps> = ({ formId }) => {
  const [formConfig, setFormConfig] = React.useState<FormConfig | null>(null);
  const [formData, setFormData] = React.useState<any>({});
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Fetch form configuration
    fetch(`/api/form-config/${formId}`)
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

  const handleSubmit = async ({ formData }: any) => {
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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              <span className="ml-3 text-gray-600">Loading form...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8 text-center">
            <div className="mb-4">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Success!</h2>
            <p className="text-gray-600">{formConfig?.success_message}</p>
          </CardContent>
        </Card>
      </div>
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

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>{formConfig.form_title}</CardTitle>
            <CardDescription>Please fill out the information below</CardDescription>
          </CardHeader>
          <CardContent>
            <Form
              schema={formConfig.schema}
              uiSchema={enhancedUiSchema}
              formData={formData}
              onChange={({ formData }) => setFormData(formData)}
              onSubmit={handleSubmit}
              validator={validator}
              {...shadcnTheme}
            >
              <Button type="submit" disabled={submitting} className="w-full mt-4">
                {submitting ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                    Submitting...
                  </>
                ) : (
                  formConfig.submit_button_text
                )}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};