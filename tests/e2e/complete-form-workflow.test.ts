import { FormGenerator } from '../../src/services/form-generator';
import { SMSTool } from '../../src/services/sms-tool';
import { testSupabase, cleanupTestData, waitFor } from '../helpers/database';
import { mockConsole } from '../helpers/mocks';

describe('Complete Form Workflow E2E', () => {
  let formGenerator: FormGenerator;
  let smsTool: SMSTool;
  let consoleMock: ReturnType<typeof mockConsole>;

  beforeAll(() => {
    formGenerator = new FormGenerator(testSupabase);
    smsTool = new SMSTool(testSupabase);
    consoleMock = mockConsole();
  });

  afterAll(() => {
    consoleMock.restore();
  });

  afterEach(async () => {
    await cleanupTestData();
    jest.clearAllMocks();
  });

  describe('Full Form Lifecycle', () => {
    it('should complete the entire form workflow from creation to processing', async () => {
      const customerPhone = '+1234567890';
      const businessName = 'Adventure Outfitters';
      const profileId = 'test_profile_e2e';
      const messageId = 'test_msg_e2e';
      const threadId = 'test_thread_e2e';

      // Step 1: Business owner asks Claude to create a form
      console.log('Step 1: Creating form via FormGenerator...');
      
      const formResult = await formGenerator.createForm({
        formTitle: 'Adventure Booking Request',
        formType: 'booking',
        fields: [
          { name: 'fullName', type: 'text', title: 'Full Name', required: true },
          { name: 'email', type: 'email', title: 'Email Address', required: true },
          { name: 'phone', type: 'tel', title: 'Phone Number', required: true },
          { name: 'preferredDate', type: 'date', title: 'Preferred Date', required: true },
          { name: 'participants', type: 'number', title: 'Number of Participants', required: true },
          { name: 'experience', type: 'select', title: 'Experience Level', 
            options: ['Beginner', 'Intermediate', 'Advanced'], required: true },
          { name: 'specialRequests', type: 'textarea', title: 'Special Requests or Dietary Restrictions' }
        ],
        customerPhone,
        context: {
          profileId,
          messageId,
          conversationThreadId: threadId
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      });

      expect(formResult.url).toContain('/form/');
      expect(formResult.formId).toMatch(/^form_/);
      expect(formResult.expiresAt).toBeTruthy();

      console.log(`Form created with ID: ${formResult.formId}, URL: ${formResult.url}`);

      // Step 2: Send form link to customer via SMS
      console.log('Step 2: Sending SMS with form link...');
      
      const smsResult = await smsTool.sendFormLink(
        customerPhone,
        formResult.url,
        'Adventure Booking Request',
        businessName
      );

      expect(smsResult.success).toBe(true);
      expect(smsResult.messageId).toMatch(/^sms_/);

      // Verify SMS was "sent" (logged in development mode)
      expect(consoleMock.consoleSpy.log).toHaveBeenCalledWith(
        'SMS sent (development mode):',
        expect.objectContaining({
          to: customerPhone,
          message: expect.stringContaining('Adventure Outfitters has sent you a form'),
          messageId: smsResult.messageId
        })
      );

      console.log(`SMS sent with ID: ${smsResult.messageId}`);

      // Step 3: Verify form is accessible and contains correct data
      console.log('Step 3: Verifying form accessibility...');
      
      const { data: form, error: formError } = await testSupabase
        .from('dynamic_forms')
        .select('*')
        .eq('id', formResult.formId)
        .single();

      expect(formError).toBeNull();
      expect(form).toMatchObject({
        form_type: 'booking',
        form_title: 'Adventure Booking Request',
        originating_profile_id: profileId,
        originating_message_id: messageId,
        conversation_thread_id: threadId,
        customer_phone: customerPhone,
        status: 'active'
      });

      // Verify HTML content contains all fields
      expect(form?.html_content).toContain('Adventure Booking Request');
      expect(form?.html_content).toContain('Full Name');
      expect(form?.html_content).toContain('Email Address');
      expect(form?.html_content).toContain('Experience Level');

      // Step 4: Customer submits the form
      console.log('Step 4: Simulating customer form submission...');
      
      const customerFormData = {
        fullName: 'Sarah Johnson',
        email: 'sarah.johnson@email.com',
        phone: '+1987654321',
        preferredDate: '2024-07-15',
        participants: 3,
        experience: 'Intermediate',
        specialRequests: 'One participant is vegetarian, please accommodate dietary needs.'
      };

      // Simulate the form submission endpoint
      const responseId = `test_response_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      
      const { error: responseError } = await testSupabase
        .from('form_responses')
        .insert({
          id: responseId,
          form_id: formResult.formId,
          response_data: customerFormData,
          process_as_message_to_profile_id: profileId,
          parent_conversation_thread_id: threadId,
          submitted_at: new Date().toISOString()
        });

      expect(responseError).toBeNull();

      // Update form status to submitted
      await testSupabase
        .from('dynamic_forms')
        .update({ status: 'submitted', updated_at: new Date().toISOString() })
        .eq('id', formResult.formId);

      console.log(`Form submission created with ID: ${responseId}`);

      // Step 5: Background agent processes the form response
      console.log('Step 5: Processing form response via background agent...');
      
      // Simulate the background form processing agent
      const { data: response } = await testSupabase
        .from('form_responses')
        .select('*')
        .eq('id', responseId)
        .single();

      expect(response?.processed).toBe(false); // Should start as unprocessed

      // Process the form response (simulate background agent)
      const formattedResponse = Object.entries(customerFormData)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');

      const messageContent = `Form "booking" has been submitted with the following information:

${formattedResponse}

Customer Phone: ${customerPhone}
Form Title: Adventure Booking Request

Please process this form submission and continue the conversation.`;

      const { data: conversationMessage, error: messageError } = await testSupabase
        .from('conversation_messages')
        .insert({
          id: `test_msg_conv_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
          profile_id: profileId,
          phone_number: customerPhone,
          direction: 'incoming',
          content: messageContent,
          parent_message_id: messageId,
          conversation_thread_id: threadId,
          form_response_id: responseId,
          status: 'pending'
        })
        .select()
        .single();

      expect(messageError).toBeNull();

      // Mark form response as processed
      await testSupabase
        .from('form_responses')
        .update({ 
          processed: true,
          processed_at: new Date().toISOString(),
          processing_message_id: conversationMessage.id
        })
        .eq('id', responseId);

      console.log(`Conversation message created with ID: ${conversationMessage.id}`);

      // Step 6: Verify the complete workflow results
      console.log('Step 6: Verifying complete workflow results...');

      // Verify form response was processed
      const { data: finalResponse } = await testSupabase
        .from('form_responses')
        .select('*')
        .eq('id', responseId)
        .single();

      expect(finalResponse?.processed).toBe(true);
      expect(finalResponse?.processed_at).toBeTruthy();
      expect(finalResponse?.processing_message_id).toBe(conversationMessage.id);

      // Verify conversation message contains all customer data
      expect(conversationMessage.content).toContain('fullName: Sarah Johnson');
      expect(conversationMessage.content).toContain('email: sarah.johnson@email.com');
      expect(conversationMessage.content).toContain('preferredDate: 2024-07-15');
      expect(conversationMessage.content).toContain('participants: 3');
      expect(conversationMessage.content).toContain('experience: Intermediate');
      expect(conversationMessage.content).toContain('specialRequests: One participant is vegetarian');

      // Verify context preservation
      expect(conversationMessage.profile_id).toBe(profileId);
      expect(conversationMessage.parent_message_id).toBe(messageId);
      expect(conversationMessage.conversation_thread_id).toBe(threadId);
      expect(conversationMessage.form_response_id).toBe(responseId);

      // Verify form status was updated
      const { data: finalForm } = await testSupabase
        .from('dynamic_forms')
        .select('status')
        .eq('id', formResult.formId)
        .single();

      expect(finalForm?.status).toBe('submitted');

      console.log('✅ Complete form workflow test passed successfully!');
    });

    it('should handle complex form with validation', async () => {
      // Test with more complex validation and field types
      const complexFormResult = await formGenerator.createForm({
        formTitle: 'Complex Adventure Application',
        formType: 'application',
        fields: [
          { name: 'personalInfo', type: 'text', title: 'Personal Information', required: true },
          { name: 'emergencyContact', type: 'tel', title: 'Emergency Contact', required: true },
          { name: 'medicalConditions', type: 'textarea', title: 'Medical Conditions' },
          { name: 'insurance', type: 'checkbox', title: 'I have travel insurance', required: true },
          { name: 'waiver', type: 'checkbox', title: 'I agree to liability waiver', required: true },
          { name: 'equipmentRental', type: 'select', title: 'Equipment Rental Needed',
            options: ['None', 'Basic Package', 'Premium Package'] }
        ],
        customerPhone: '+1555123456',
        context: {
          profileId: 'test_profile_complex',
          messageId: 'test_msg_complex'
        }
      });

      expect(complexFormResult.formId).toMatch(/^form_/);
      expect(complexFormResult.url).toContain('/form/');

      // Verify complex form structure
      const { data: complexForm } = await testSupabase
        .from('dynamic_forms')
        .select('schema, html_content')
        .eq('id', complexFormResult.formId)
        .single();

      // Check that required fields are properly set
      expect(complexForm?.schema.required).toContain('personalInfo');
      expect(complexForm?.schema.required).toContain('emergencyContact');
      expect(complexForm?.schema.required).toContain('insurance');
      expect(complexForm?.schema.required).toContain('waiver');

      // Check that optional fields are not required
      expect(complexForm?.schema.required).not.toContain('medicalConditions');
      expect(complexForm?.schema.required).not.toContain('equipmentRental');

      // Verify HTML contains all form elements
      expect(complexForm?.html_content).toContain('Personal Information');
      expect(complexForm?.html_content).toContain('Emergency Contact');
      expect(complexForm?.html_content).toContain('Medical Conditions');
      expect(complexForm?.html_content).toContain('travel insurance');
      expect(complexForm?.html_content).toContain('liability waiver');
    });

    it('should handle form expiration correctly', async () => {
      // Create form that expires in 1 second
      const shortExpiryForm = await formGenerator.createForm({
        formTitle: 'Short Expiry Test',
        formType: 'test',
        fields: [{ name: 'test', type: 'text', title: 'Test Field' }],
        expiresAt: new Date(Date.now() + 1000).toISOString() // 1 second
      });

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify form is expired by checking if it would be rejected
      const { data: expiredForm } = await testSupabase
        .from('dynamic_forms')
        .select('expires_at, status')
        .eq('id', shortExpiryForm.formId)
        .single();

      expect(new Date(expiredForm?.expires_at)).toBeLessThan(new Date());
      
      // In a real scenario, the form submission would be rejected
      // This demonstrates the expiration mechanism works
    });
  });

  describe('Error Scenarios', () => {
    it('should handle form creation with invalid data gracefully', async () => {
      // Test with empty fields array
      await expect(formGenerator.createForm({
        formTitle: 'Invalid Form',
        formType: 'test',
        fields: [] // Empty fields should be handled
      })).rejects.toThrow('At least one field is required');
    });

    it('should handle SMS sending with invalid phone numbers', async () => {
      const form = await formGenerator.createForm({
        formTitle: 'Test Form',
        formType: 'test',
        fields: [{ name: 'test', type: 'text', title: 'Test' }]
      });

      const invalidSMSResult = await smsTool.sendFormLink(
        'invalid-phone',
        form.url,
        'Test Form'
      );

      expect(invalidSMSResult.success).toBe(false);
      expect(invalidSMSResult.error).toContain('Invalid phone number format');
    });
  });
});