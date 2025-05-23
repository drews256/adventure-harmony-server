import { Mastra } from '@mastra/core';
import { mastraAgents } from './agents';
import { mastraTools } from './tools';

// Initialize Mastra instance with all agents and tools
export const mastra = new Mastra({
  agents: mastraAgents
});

// Message processing function using Mastra agents
export async function processMessageWithMastra(
  message: string,
  profileId: string,
  phoneNumber?: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ success: boolean; response?: string; error?: string; toolResults?: any[] }> {
  try {
    // Determine which agent to use based on message content
    const agent = selectAgentForMessage(message);
    
    // Build context for the agent
    const contextMessages = conversationHistory || [];
    contextMessages.push({ role: 'user', content: message });
    
    // Execute agent with the message
    const result = await agent.text({
      messages: contextMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      // Pass profile context
      context: {
        profileId,
        phoneNumber
      }
    });
    
    return {
      success: true,
      response: result.text,
      toolResults: result.toolCalls || []
    };
    
  } catch (error) {
    console.error('Mastra processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Agent selection logic based on message content
function selectAgentForMessage(message: string): any {
  const lowerMessage = message.toLowerCase();
  
  // Form-related keywords
  if (lowerMessage.includes('form') || lowerMessage.includes('survey') || 
      lowerMessage.includes('questionnaire') || lowerMessage.includes('collect')) {
    return mastraAgents.formManager;
  }
  
  // Calendar/scheduling keywords  
  if (lowerMessage.includes('calendar') || lowerMessage.includes('schedule') ||
      lowerMessage.includes('event') || lowerMessage.includes('booking') ||
      lowerMessage.includes('available') || lowerMessage.includes('appointment')) {
    return mastraAgents.scheduling;
  }
  
  // SMS/communication keywords
  if (lowerMessage.includes('send') || lowerMessage.includes('message') ||
      lowerMessage.includes('text') || lowerMessage.includes('notify')) {
    return mastraAgents.communication;
  }
  
  // Default to main message processor
  return mastraAgents.messageProcessor;
}

// Simplified workflow for form creation with SMS notification
export async function createFormAndNotifyWorkflow(
  formData: {
    title: string;
    type: string;
    fields: Array<{
      name: string;
      label: string;
      type: 'text' | 'email' | 'phone' | 'number' | 'select' | 'textarea' | 'checkbox';
      required?: boolean;
      options?: string[];
    }>;
  },
  customerPhone: string,
  profileId: string,
  businessName?: string
): Promise<{ success: boolean; formId?: string; formUrl?: string; error?: string }> {
  try {
    // Prepare the context with proper types
    const context = {
      formTitle: formData.title,
      formType: formData.type,
      fields: formData.fields.map(field => ({
        ...field,
        required: field.required || false
      })),
      customerPhone,
      profileId,
      businessName
    };

    // Use the tool directly since we're having issues with the execute method types
    const formGen = new (await import('../services/form-generator')).FormGenerator(
      (await import('@supabase/supabase-js')).createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )
    );

    const formResult = await formGen.createForm({
      formTitle: formData.title,
      formType: formData.type,
      fields: formData.fields,
      originatingProfileId: profileId,
      customerPhone
    });

    // Send SMS notification
    const smsResult = await (await import('../services/sms-tool')).SMSTool.prototype.sendFormLink.call(
      new (await import('../services/sms-tool')).SMSTool(
        (await import('@supabase/supabase-js')).createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
      ),
      customerPhone,
      formResult.url,
      formData.title,
      businessName
    );

    return {
      success: true,
      formId: formResult.formId,
      formUrl: formResult.url
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Export individual tools for direct use
export { mastraTools, mastraAgents };

// Helper function to validate Mastra setup
export function validateMastraSetup(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // Check environment variables
  if (!process.env.SUPABASE_URL) {
    issues.push('SUPABASE_URL environment variable not set');
  }
  
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    issues.push('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  }
  
  if (!process.env.ANTHROPIC_API_KEY) {
    issues.push('ANTHROPIC_API_KEY environment variable not set');
  }
  
  // Check agent availability
  const agentCount = Object.keys(mastraAgents).length;
  if (agentCount === 0) {
    issues.push('No agents configured');
  }
  
  // Check tool availability
  const toolCount = Object.keys(mastraTools).length;
  if (toolCount === 0) {
    issues.push('No tools configured');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}