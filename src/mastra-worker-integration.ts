/**
 * Integration point for using Mastra in the existing worker system
 * This provides a drop-in replacement for the current message processing
 */

import { processMessageWithMastra, createFormAndNotifyWorkflow, validateMastraSetup } from './mastra';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ConversationMessage {
  id: string;
  content: string;
  direction: 'incoming' | 'outgoing';
  phone_number: string;
  profile_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  parent_id?: string;
}

/**
 * Process a conversation message using Mastra agents
 * This can be used as a drop-in replacement for existing message processing
 */
export async function processMastraMessage(message: ConversationMessage): Promise<{
  success: boolean;
  response?: string;
  actions?: Array<{ type: string; data: any }>;
  error?: string;
}> {
  try {
    console.log(`🤖 Processing message with Mastra: ${message.content}`);
    
    // Get conversation history for context
    const { data: history } = await supabase
      .from('conversation_messages')
      .select('content, direction, created_at')
      .eq('phone_number', message.phone_number)
      .eq('profile_id', message.profile_id)
      .order('created_at', { ascending: true })
      .limit(10);

    // Convert to conversation history format
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = history?.map(msg => ({
      role: (msg.direction === 'incoming' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: String(msg.content)
    })) || [];

    // Process with Mastra
    const result = await processMessageWithMastra(
      message.content,
      message.profile_id,
      message.phone_number,
      conversationHistory
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Mastra processing failed'
      };
    }

    // Create response message in database
    if (result.response) {
      await supabase
        .from('conversation_messages')
        .insert({
          content: result.response,
          direction: 'outgoing',
          phone_number: message.phone_number,
          profile_id: message.profile_id,
          status: 'completed',
          parent_id: message.id,
          created_at: new Date().toISOString()
        });
    }

    // Extract actions from tool results
    const actions = result.toolResults?.map(toolCall => ({
      type: toolCall.toolName || 'unknown',
      data: toolCall.result || toolCall
    })) || [];

    return {
      success: true,
      response: result.response,
      actions
    };

  } catch (error) {
    console.error('❌ Mastra message processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Enhanced form creation that uses Mastra workflows
 */
export async function createMastraForm(
  formData: {
    title: string;
    type: string;
    fields: Array<{
      name: string;
      label: string;
      type: string;
      required?: boolean;
      options?: string[];
    }>;
  },
  customerPhone: string,
  profileId: string,
  businessName?: string
): Promise<{ success: boolean; formId?: string; formUrl?: string; error?: string }> {
  try {
    console.log(`📋 Creating form with Mastra: ${formData.title}`);
    
    // Validate field types
    const validTypes = ['text', 'email', 'phone', 'number', 'select', 'textarea', 'checkbox'];
    const typedFields = formData.fields.map(field => ({
      ...field,
      type: validTypes.includes(field.type) ? field.type : 'text'
    })) as Array<{
      name: string;
      label: string;
      type: 'text' | 'email' | 'phone' | 'number' | 'select' | 'textarea' | 'checkbox';
      required?: boolean;
      options?: string[];
    }>;

    const result = await createFormAndNotifyWorkflow(
      {
        ...formData,
        fields: typedFields
      },
      customerPhone,
      profileId,
      businessName
    );

    console.log(`📋 Form creation result:`, result);
    return result;

  } catch (error) {
    console.error('❌ Mastra form creation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check if Mastra is properly configured and ready to use
 */
export function isMastraReady(): boolean {
  const validation = validateMastraSetup();
  return validation.valid;
}

/**
 * Get Mastra status for health checks
 */
export function getMastraStatus(): {
  ready: boolean;
  agents: number;
  tools: number;
  issues: string[];
} {
  const validation = validateMastraSetup();
  
  return {
    ready: validation.valid,
    agents: 4, // We have 4 agents configured
    tools: 4,  // We have 4 tools configured
    issues: validation.issues
  };
}

/**
 * Fallback message processing (uses existing system if Mastra fails)
 */
export async function processMessageWithFallback(
  message: ConversationMessage
): Promise<{ success: boolean; usedMastra: boolean; response?: string; error?: string }> {
  // Try Mastra first
  if (isMastraReady()) {
    const mastraResult = await processMastraMessage(message);
    
    if (mastraResult.success) {
      return {
        success: true,
        usedMastra: true,
        response: mastraResult.response
      };
    }
    
    console.warn('⚠️ Mastra processing failed, falling back to existing system');
  }

  // Fallback to existing system
  try {
    // Here you would call your existing message processing logic
    // For now, return a simple response
    const fallbackResponse = "I received your message and I'm processing it with the standard system.";
    
    // Store response in database
    await supabase
      .from('conversation_messages')
      .insert({
        content: fallbackResponse,
        direction: 'outgoing',
        phone_number: message.phone_number,
        profile_id: message.profile_id,
        status: 'completed',
        parent_id: message.id,
        created_at: new Date().toISOString()
      });

    return {
      success: true,
      usedMastra: false,
      response: fallbackResponse
    };

  } catch (error) {
    return {
      success: false,
      usedMastra: false,
      error: error instanceof Error ? error.message : 'Fallback processing failed'
    };
  }
}

// Export for easy integration
export {
  processMessageWithMastra,
  createFormAndNotifyWorkflow,
  validateMastraSetup
} from './mastra';