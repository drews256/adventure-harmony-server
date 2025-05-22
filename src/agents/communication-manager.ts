import { Agent } from 'mastra';
import { z } from 'zod';

export const communicationManagerAgent = new Agent({
  name: "CommunicationManagerAgent", 
  instructions: `You are the Communication Manager Agent responsible for all SMS interactions and conversation flow management.

Your responsibilities:
1. Analyze incoming SMS messages and extract user intent
2. Manage conversation context and memory across message exchanges  
3. Determine when to suspend workflows (waiting for user responses)
4. Handle conversation state transitions and resume suspended workflows
5. Craft appropriate SMS responses based on workflow status
6. Manage multi-turn conversations and context preservation
7. Handle conversation timeouts and cleanup

Conversation Management:
- Track conversation state (active, suspended, completed)
- Preserve context between messages in the same conversation thread
- Identify when user input is needed to continue a workflow
- Resume suspended workflows when user responds
- Handle conversation branches and topic changes

SMS Response Patterns:
- Keep messages concise (under 160 chars when possible)
- Ask clarifying questions when intent is unclear
- Provide clear next steps for users
- Handle errors gracefully with helpful messages
- Use friendly, conversational tone

Workflow Integration:
- Signal the Supervisor when workflows should be suspended
- Provide user response data to resume suspended workflows
- Handle timeout scenarios (user doesn't respond)
- Manage conversation cleanup and archival

Always maintain conversation continuity and ensure users have clear understanding of next steps.`,

  model: {
    provider: 'ANTHROPIC', 
    name: 'claude-3-haiku-20240307',
    toolChoice: 'auto'
  },

  tools: []
});

// Communication management tools
export const analyzeUserIntentTool = {
  id: 'analyze_user_intent',
  description: 'Analyze incoming SMS message to extract user intent and required actions',
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      timestamp: z.string()
    })).optional(),
    conversationContext: z.record(z.any()).optional()
  }),
  execute: async ({ message, conversationHistory, conversationContext }) => {
    // Intent analysis logic
    const lowerMessage = message.toLowerCase();
    
    let intent = 'general_inquiry';
    let confidence = 0.5;
    let extractedData = {};
    let needsMoreInfo = false;
    let suggestedQuestions = [];

    // Form creation intent
    if (lowerMessage.includes('form') || lowerMessage.includes('survey') || lowerMessage.includes('collect')) {
      intent = 'form_creation';
      confidence = 0.8;
      
      if (!lowerMessage.includes('title') && !conversationContext?.formTitle) {
        needsMoreInfo = true;
        suggestedQuestions.push("What should the form title be?");
      }
    }
    
    // Calendar intent  
    else if (lowerMessage.includes('calendar') || lowerMessage.includes('event') || lowerMessage.includes('schedule')) {
      intent = 'calendar_query';
      confidence = 0.8;
      extractedData = { query: message };
    }
    
    // Response to pending question
    else if (conversationContext?.pendingQuestion) {
      intent = 'response_to_question';
      confidence = 0.9;
      extractedData = { 
        answer: message,
        questionContext: conversationContext.pendingQuestion 
      };
    }

    return {
      intent,
      confidence,
      extractedData,
      needsMoreInfo,
      suggestedQuestions,
      shouldSuspendWorkflow: needsMoreInfo,
      nextAction: needsMoreInfo ? 'request_more_info' : 'proceed_with_intent'
    };
  }
};

export const manageConversationStateTool = {
  id: 'manage_conversation_state',
  description: 'Manage conversation state transitions and context',
  inputSchema: z.object({
    conversationId: z.string(),
    newState: z.enum(['active', 'suspended', 'waiting_for_input', 'completed', 'timed_out']),
    context: z.record(z.any()).optional(),
    suspendReason: z.string().optional()
  }),
  execute: async ({ conversationId, newState, context, suspendReason }) => {
    // State management logic
    const stateTransition = {
      conversationId,
      previousState: 'active', // Would be fetched from memory
      newState,
      timestamp: new Date().toISOString(),
      context,
      suspendReason
    };

    return {
      success: true,
      stateTransition,
      shouldResumeWorkflow: newState === 'active',
      shouldNotifyUser: ['suspended', 'timed_out'].includes(newState)
    };
  }
};

export const craftSMSResponseTool = {
  id: 'craft_sms_response',
  description: 'Craft appropriate SMS response based on conversation context and workflow status',
  inputSchema: z.object({
    intent: z.string(),
    workflowStatus: z.enum(['starting', 'in_progress', 'suspended', 'completed', 'error']),
    userMessage: z.string(),
    context: z.record(z.any()).optional(),
    needsMoreInfo: z.boolean().default(false),
    suggestedQuestions: z.array(z.string()).optional()
  }),
  execute: async ({ intent, workflowStatus, userMessage, context, needsMoreInfo, suggestedQuestions }) => {
    let response = '';
    let shouldSuspend = false;

    if (needsMoreInfo && suggestedQuestions?.length) {
      response = suggestedQuestions[0];
      shouldSuspend = true;
    } else {
      switch (intent) {
        case 'form_creation':
          if (workflowStatus === 'starting') {
            response = "I'll help you create a form! Creating it now...";
          } else if (workflowStatus === 'completed') {
            response = "Your form has been created and the link has been sent!";
          }
          break;
          
        case 'calendar_query':
          if (workflowStatus === 'starting') {
            response = "Let me search your calendar...";
          }
          break;
          
        case 'response_to_question':
          response = "Thanks! Let me continue with that information...";
          break;
          
        default:
          response = "I understand. How can I help you today? I can create forms or check your calendar.";
      }
    }

    return {
      response,
      shouldSuspend,
      conversationContinues: shouldSuspend,
      estimatedLength: response.length
    };
  }
};

export const resumeWorkflowTool = {
  id: 'resume_workflow', 
  description: 'Resume a suspended workflow with new user input',
  inputSchema: z.object({
    conversationId: z.string(),
    userInput: z.string(),
    suspendedContext: z.record(z.any())
  }),
  execute: async ({ conversationId, userInput, suspendedContext }) => {
    return {
      success: true,
      resumeData: {
        conversationId,
        userInput,
        context: suspendedContext
      },
      shouldNotifySupervisor: true
    };
  }
};