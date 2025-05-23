import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dhelbmzzhobadauctczs.supabase.co';
// For tests, we'll use the anon key since we don't have service role key access
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZWxibXp6aG9iYWRhdWN0Y3pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIyNjE4NjAsImV4cCI6MjA1NzgzNzg2MH0.YsAuD4nlB2dF5vNGs7itgRO21yRYx6Ge8MYeCIXDMzo';

export const testSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Clean up test data from the database
 */
export async function cleanupTestData() {
  const testPrefix = 'test_';
  
  try {
    // Clean up test form responses
    await testSupabase
      .from('form_responses')
      .delete()
      .like('id', `${testPrefix}%`);
    
    // Clean up test dynamic forms
    await testSupabase
      .from('dynamic_forms')
      .delete()
      .like('id', `${testPrefix}%`);
    
    // Clean up test conversation messages
    await testSupabase
      .from('conversation_messages')
      .delete()
      .like('id', `${testPrefix}%`);
    
    // Clean up test calendar displays
    await testSupabase
      .from('calendar_displays')
      .delete()
      .like('id', `${testPrefix}%`);
    
    // Clean up test help requests
    await testSupabase
      .from('help_requests')
      .delete()
      .like('id', `${testPrefix}%`);
      
    console.log('Test data cleanup completed');
  } catch (error) {
    console.error('Error cleaning up test data:', error);
  }
}

/**
 * Create test conversation message
 */
export async function createTestMessage(overrides: Partial<any> = {}) {
  const testMessage = {
    id: `test_msg_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
    profile_id: 'test_profile_123',
    phone_number: '+1234567890',
    direction: 'incoming',
    content: 'Test message content',
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides
  };
  
  const { data, error } = await testSupabase
    .from('conversation_messages')
    .insert(testMessage)
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

/**
 * Create test dynamic form
 */
export async function createTestForm(overrides: Partial<any> = {}) {
  const testForm = {
    id: `test_form_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
    originating_profile_id: 'test_profile_123',
    form_type: 'booking',
    form_title: 'Test Booking Form',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name' },
        email: { type: 'string', title: 'Email' }
      }
    },
    html_content: '<html>Test Form</html>',
    customer_phone: '+1234567890',
    status: 'active',
    ...overrides
  };
  
  const { data, error } = await testSupabase
    .from('dynamic_forms')
    .insert(testForm)
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

/**
 * Create test form response
 */
export async function createTestFormResponse(formId: string, overrides: Partial<any> = {}) {
  const testResponse = {
    id: `test_response_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
    form_id: formId,
    response_data: {
      name: 'John Doe',
      email: 'john@example.com'
    },
    process_as_message_to_profile_id: 'test_profile_123',
    processed: false,
    submitted_at: new Date().toISOString(),
    ...overrides
  };
  
  const { data, error } = await testSupabase
    .from('form_responses')
    .insert(testResponse)
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

/**
 * Wait for a condition to be true (useful for testing async operations)
 */
export async function waitFor(
  condition: () => Promise<boolean>, 
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}