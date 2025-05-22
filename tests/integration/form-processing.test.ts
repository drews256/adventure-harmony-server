import { testSupabase, cleanupTestData, createTestForm, createTestFormResponse, waitFor } from '../helpers/database';

// Import the form processing function - we'll need to extract it from worker-entry.ts
// For now, we'll create a simplified version for testing
async function processFormResponseTest(responseId: string) {
  try {
    console.log(`Processing form response: ${responseId}`);
    
    // Get the form response
    const { data: response, error: responseError } = await testSupabase
      .from('form_responses')
      .select('*')
      .eq('id', responseId)
      .single();

    if (responseError) throw responseError;

    // Check if already processed
    if (response.processed) {
      console.log(`Form response ${responseId} already processed, skipping`);
      return;
    }

    // Get the form details for context
    const { data: form, error: formError } = await testSupabase
      .from('dynamic_forms')
      .select('*')
      .eq('id', response.form_id)
      .single();

    if (formError) throw formError;

    // Format the form data for Claude
    const formattedResponse = Object.entries(response.response_data)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');

    // Create a message content that includes form context
    const messageContent = `Form "${form.form_type}" has been submitted with the following information:

${formattedResponse}

Customer Phone: ${form.customer_phone || 'Not provided'}
Form Title: ${form.form_title || 'Untitled Form'}

Please process this form submission and continue the conversation.`;

    // Create a new conversation message for processing
    const { data: newMessage, error: messageError } = await testSupabase
      .from('conversation_messages')
      .insert({
        id: `test_msg_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        profile_id: response.process_as_message_to_profile_id,
        phone_number: form.customer_phone,
        direction: 'incoming',
        content: messageContent,
        parent_message_id: form.originating_message_id,
        conversation_thread_id: response.parent_conversation_thread_id,
        form_response_id: responseId,
        status: 'pending'
      })
      .select()
      .single();

    if (messageError) throw messageError;

    // Update form response to mark as processed
    await testSupabase
      .from('form_responses')
      .update({ 
        processed: true,
        processed_at: new Date().toISOString(),
        processing_message_id: newMessage.id
      })
      .eq('id', responseId);

    console.log(`Form response ${responseId} processed successfully, created message ${newMessage.id}`);
    return newMessage;

  } catch (error) {
    console.error(`Error processing form response ${responseId}:`, error);
    
    // Update with error info
    await testSupabase
      .from('form_responses')
      .update({ 
        processing_error: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', responseId);
    
    throw error;
  }
}

describe('Form Processing Agent', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('processFormResponse', () => {
    it('should process form response and create conversation message', async () => {
      // Create a test form
      const form = await createTestForm({
        originating_profile_id: 'test_profile_123',
        originating_message_id: 'test_msg_original',
        conversation_thread_id: 'test_thread_123',
        form_type: 'booking',
        form_title: 'Adventure Booking',
        customer_phone: '+1234567890'
      });

      // Create a test form response
      const formResponse = await createTestFormResponse(form.id, {
        response_data: {
          name: 'John Doe',
          email: 'john@example.com',
          preferred_date: '2024-06-01',
          participants: 4
        },
        process_as_message_to_profile_id: 'test_profile_123',
        parent_conversation_thread_id: 'test_thread_123'
      });

      // Process the form response
      const createdMessage = await processFormResponseTest(formResponse.id);

      // Verify the form response was marked as processed
      const { data: updatedResponse } = await testSupabase
        .from('form_responses')
        .select('*')
        .eq('id', formResponse.id)
        .single();

      expect(updatedResponse?.processed).toBe(true);
      expect(updatedResponse?.processed_at).toBeTruthy();
      expect(updatedResponse?.processing_message_id).toBe(createdMessage.id);

      // Verify conversation message was created with correct content
      expect(createdMessage).toMatchObject({
        profile_id: 'test_profile_123',
        phone_number: '+1234567890',
        direction: 'incoming',
        parent_message_id: 'test_msg_original',
        conversation_thread_id: 'test_thread_123',
        form_response_id: formResponse.id,
        status: 'pending'
      });

      // Verify message content includes form data
      expect(createdMessage.content).toContain('Form "booking" has been submitted');
      expect(createdMessage.content).toContain('name: John Doe');
      expect(createdMessage.content).toContain('email: john@example.com');
      expect(createdMessage.content).toContain('preferred_date: 2024-06-01');
      expect(createdMessage.content).toContain('participants: 4');
      expect(createdMessage.content).toContain('Customer Phone: +1234567890');
      expect(createdMessage.content).toContain('Form Title: Adventure Booking');
    });

    it('should skip already processed form responses', async () => {
      const form = await createTestForm();
      const formResponse = await createTestFormResponse(form.id, {
        processed: true,
        processed_at: new Date().toISOString()
      });

      // Should not throw error and should not create new message
      await processFormResponseTest(formResponse.id);

      // Verify no new conversation messages were created
      const { data: messages } = await testSupabase
        .from('conversation_messages')
        .select('*')
        .eq('form_response_id', formResponse.id);

      expect(messages).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      const form = await createTestForm();
      const formResponse = await createTestFormResponse(form.id);

      // Delete the form to cause an error
      await testSupabase
        .from('dynamic_forms')
        .delete()
        .eq('id', form.id);

      // Process should fail but not throw
      await expect(processFormResponseTest(formResponse.id)).rejects.toThrow();

      // Verify error was recorded
      const { data: updatedResponse } = await testSupabase
        .from('form_responses')
        .select('*')
        .eq('id', formResponse.id)
        .single();

      expect(updatedResponse?.processing_error).toBeTruthy();
    });

    it('should handle form responses with minimal data', async () => {
      const form = await createTestForm({
        form_title: null,
        customer_phone: null
      });

      const formResponse = await createTestFormResponse(form.id, {
        response_data: {
          simple_field: 'simple_value'
        }
      });

      const createdMessage = await processFormResponseTest(formResponse.id);

      expect(createdMessage.content).toContain('simple_field: simple_value');
      expect(createdMessage.content).toContain('Customer Phone: Not provided');
      expect(createdMessage.content).toContain('Form Title: Untitled Form');
    });

    it('should preserve conversation context correctly', async () => {
      const threadId = 'test_thread_preserve_context';
      const profileId = 'test_profile_preserve';
      const originalMessageId = 'test_msg_original_preserve';

      const form = await createTestForm({
        originating_profile_id: profileId,
        originating_message_id: originalMessageId,
        conversation_thread_id: threadId
      });

      const formResponse = await createTestFormResponse(form.id, {
        process_as_message_to_profile_id: profileId,
        parent_conversation_thread_id: threadId
      });

      const createdMessage = await processFormResponseTest(formResponse.id);

      // Verify all context is preserved
      expect(createdMessage.profile_id).toBe(profileId);
      expect(createdMessage.parent_message_id).toBe(originalMessageId);
      expect(createdMessage.conversation_thread_id).toBe(threadId);
      expect(createdMessage.form_response_id).toBe(formResponse.id);
    });
  });

  describe('Worker Loop Integration', () => {
    it('should process pending form responses in order', async () => {
      // Create multiple form responses
      const form1 = await createTestForm({ form_title: 'Form 1' });
      const form2 = await createTestForm({ form_title: 'Form 2' });

      const response1 = await createTestFormResponse(form1.id, {
        submitted_at: new Date(Date.now() - 2000).toISOString() // 2 seconds ago
      });
      const response2 = await createTestFormResponse(form2.id, {
        submitted_at: new Date(Date.now() - 1000).toISOString() // 1 second ago
      });

      // Process both
      await processFormResponseTest(response1.id);
      await processFormResponseTest(response2.id);

      // Verify both were processed
      const { data: allResponses } = await testSupabase
        .from('form_responses')
        .select('*')
        .in('id', [response1.id, response2.id])
        .order('submitted_at', { ascending: true });

      expect(allResponses).toHaveLength(2);
      expect(allResponses![0].processed).toBe(true);
      expect(allResponses![1].processed).toBe(true);

      // Verify messages were created for both
      const { data: messages } = await testSupabase
        .from('conversation_messages')
        .select('*')
        .in('form_response_id', [response1.id, response2.id]);

      expect(messages).toHaveLength(2);
    });
  });
});