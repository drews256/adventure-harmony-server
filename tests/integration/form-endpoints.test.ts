import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { testSupabase, cleanupTestData, createTestForm } from '../helpers/database';

// Create a test app similar to the main server
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Import and add the form endpoints
  // Note: We'll need to extract the endpoint logic or mock the full server
  
  // Form serving endpoint
  app.get('/form/:formId', async (req, res) => {
    try {
      const { formId } = req.params;
      
      const { data: form, error } = await testSupabase
        .from('dynamic_forms')
        .select('*')
        .eq('id', formId)
        .single();
      
      if (error || !form) {
        return res.status(404).send('Form not found');
      }
      
      if (form.status !== 'active') {
        return res.status(400).send('Form is no longer active');
      }
      
      if (form.expires_at && new Date(form.expires_at) < new Date()) {
        return res.status(410).send('Form has expired');
      }
      
      res.setHeader('Content-Type', 'text/html');
      res.send(form.html_content);
    } catch (error) {
      console.error('Error serving form:', error);
      res.status(500).send('Internal server error');
    }
  });

  // Form submission endpoint
  app.post('/api/form-submit', async (req, res) => {
    try {
      const { formId, data } = req.body;
      
      if (!formId || !data) {
        return res.status(400).json({ error: 'Missing formId or data' });
      }
      
      const { data: form, error: formError } = await testSupabase
        .from('dynamic_forms')
        .select('*')
        .eq('id', formId)
        .single();
      
      if (formError || !form) {
        return res.status(404).json({ error: 'Form not found' });
      }
      
      if (form.status !== 'active') {
        return res.status(400).json({ error: 'Form is no longer active' });
      }
      
      if (form.expires_at && new Date(form.expires_at) < new Date()) {
        return res.status(400).json({ error: 'Form has expired' });
      }
      
      const responseId = `test_response_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      
      const { error: responseError } = await testSupabase
        .from('form_responses')
        .insert({
          id: responseId,
          form_id: formId,
          response_data: data,
          process_as_message_to_profile_id: form.originating_profile_id,
          parent_conversation_thread_id: form.conversation_thread_id,
          submitted_at: new Date().toISOString()
        });
      
      if (responseError) {
        console.error('Error storing form response:', responseError);
        return res.status(500).json({ error: 'Failed to store response' });
      }
      
      await testSupabase
        .from('dynamic_forms')
        .update({ status: 'submitted', updated_at: new Date().toISOString() })
        .eq('id', formId);
      
      res.json({ success: true, message: 'Form submitted successfully' });
      
    } catch (error) {
      console.error('Error processing form submission:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Internal server error' 
      });
    }
  });

  return app;
};

describe('Form Endpoints Integration', () => {
  let app: express.Application;
  
  beforeAll(() => {
    app = createTestApp();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  describe('GET /form/:formId', () => {
    it('should serve active form HTML', async () => {
      const form = await createTestForm({
        html_content: '<html><body><h1>Test Form</h1></body></html>',
        status: 'active'
      });

      const response = await request(app)
        .get(`/form/${form.id}`)
        .expect(200)
        .expect('Content-Type', /text\/html/);

      expect(response.text).toContain('<h1>Test Form</h1>');
    });

    it('should return 404 for non-existent form', async () => {
      await request(app)
        .get('/form/non-existent-form')
        .expect(404);
    });

    it('should return 400 for inactive form', async () => {
      const form = await createTestForm({
        status: 'cancelled'
      });

      await request(app)
        .get(`/form/${form.id}`)
        .expect(400);
    });

    it('should return 410 for expired form', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const form = await createTestForm({
        expires_at: yesterday.toISOString()
      });

      await request(app)
        .get(`/form/${form.id}`)
        .expect(410);
    });
  });

  describe('POST /api/form-submit', () => {
    it('should accept valid form submission', async () => {
      const form = await createTestForm({
        status: 'active'
      });

      const submissionData = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890'
      };

      const response = await request(app)
        .post('/api/form-submit')
        .send({
          formId: form.id,
          data: submissionData
        })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Form submitted successfully'
      });

      // Verify form response was stored
      const { data: responses } = await testSupabase
        .from('form_responses')
        .select('*')
        .eq('form_id', form.id);

      expect(responses).toHaveLength(1);
      expect(responses![0].response_data).toEqual(submissionData);
      expect(responses![0].process_as_message_to_profile_id).toBe(form.originating_profile_id);

      // Verify form status was updated
      const { data: updatedForm } = await testSupabase
        .from('dynamic_forms')
        .select('status')
        .eq('id', form.id)
        .single();

      expect(updatedForm?.status).toBe('submitted');
    });

    it('should reject submission with missing data', async () => {
      await request(app)
        .post('/api/form-submit')
        .send({ formId: 'test-form' })
        .expect(400)
        .expect(response => {
          expect(response.body.error).toContain('Missing formId or data');
        });
    });

    it('should reject submission for non-existent form', async () => {
      await request(app)
        .post('/api/form-submit')
        .send({
          formId: 'non-existent',
          data: { name: 'Test' }
        })
        .expect(404)
        .expect(response => {
          expect(response.body.error).toContain('Form not found');
        });
    });

    it('should reject submission for inactive form', async () => {
      const form = await createTestForm({
        status: 'cancelled'
      });

      await request(app)
        .post('/api/form-submit')
        .send({
          formId: form.id,
          data: { name: 'Test' }
        })
        .expect(400)
        .expect(response => {
          expect(response.body.error).toContain('Form is no longer active');
        });
    });

    it('should reject submission for expired form', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const form = await createTestForm({
        expires_at: yesterday.toISOString()
      });

      await request(app)
        .post('/api/form-submit')
        .send({
          formId: form.id,
          data: { name: 'Test' }
        })
        .expect(400)
        .expect(response => {
          expect(response.body.error).toContain('Form has expired');
        });
    });
  });
});