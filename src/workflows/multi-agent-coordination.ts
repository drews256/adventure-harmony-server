import { Workflow } from 'mastra';
import { z } from 'zod';
import { supervisorAgent } from '../agents/supervisor';
import { toolOrchestratorAgent } from '../agents/tool-orchestrator';
import { communicationManagerAgent } from '../agents/communication-manager';

// Main conversation workflow with multi-agent coordination
export const conversationWorkflow = new Workflow({
  name: 'multi-agent-conversation',
  triggerSchema: z.object({
    conversationId: z.string(),
    userPhone: z.string(),
    message: z.string(),
    profileId: z.string(),
    conversationHistory: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      timestamp: z.string()
    })).optional(),
    suspendedContext: z.record(z.any()).optional()
  })
});

// Step 1: Communication Manager analyzes intent
conversationWorkflow.step('analyze-intent', {
  inputSchema: z.object({
    message: z.string(),
    conversationHistory: z.array(z.any()).optional(),
    suspendedContext: z.record(z.any()).optional()
  }),
  outputSchema: z.object({
    intent: z.string(),
    confidence: z.number(),
    extractedData: z.record(z.any()),
    needsMoreInfo: z.boolean(),
    suggestedQuestions: z.array(z.string()),
    shouldSuspendWorkflow: z.boolean()
  }),
  execute: async ({ message, conversationHistory, suspendedContext }) => {
    // This would call the Communication Manager agent
    return {
      intent: 'form_creation',
      confidence: 0.8,
      extractedData: {},
      needsMoreInfo: true,
      suggestedQuestions: ["What should the form title be?"],
      shouldSuspendWorkflow: true
    };
  }
});

// Step 2: Supervisor creates execution plan
conversationWorkflow.step('create-execution-plan', {
  inputSchema: z.object({
    intent: z.string(),
    extractedData: z.record(z.any()),
    needsMoreInfo: z.boolean(),
    conversationId: z.string(),
    profileId: z.string()
  }),
  outputSchema: z.object({
    todoList: z.array(z.object({
      id: z.string(),
      description: z.string(),
      assignedAgent: z.string(),
      status: z.string(),
      dependencies: z.array(z.string()).optional()
    })),
    shouldSuspend: z.boolean(),
    nextAction: z.string()
  }),
  execute: async ({ intent, extractedData, needsMoreInfo, conversationId, profileId }) => {
    // Supervisor analyzes and creates plan
    if (needsMoreInfo) {
      return {
        todoList: [{
          id: 'wait_for_user_input',
          description: 'Wait for user to provide missing information',
          assignedAgent: 'CommunicationManager',
          status: 'pending'
        }],
        shouldSuspend: true,
        nextAction: 'suspend_for_input'
      };
    }

    // Create execution plan for form creation
    if (intent === 'form_creation') {
      return {
        todoList: [
          {
            id: 'create_form',
            description: 'Create form with user specifications',
            assignedAgent: 'ToolOrchestrator',
            status: 'pending'
          },
          {
            id: 'send_form_link',
            description: 'Send form link via SMS',
            assignedAgent: 'ToolOrchestrator', 
            status: 'pending',
            dependencies: ['create_form']
          },
          {
            id: 'send_confirmation',
            description: 'Send confirmation message to user',
            assignedAgent: 'CommunicationManager',
            status: 'pending',
            dependencies: ['send_form_link']
          }
        ],
        shouldSuspend: false,
        nextAction: 'execute_plan'
      };
    }

    return {
      todoList: [],
      shouldSuspend: false,
      nextAction: 'handle_general_query'
    };
  }
});

// Step 3: Execute or suspend based on plan
conversationWorkflow.step('execute-or-suspend', {
  inputSchema: z.object({
    shouldSuspend: z.boolean(),
    todoList: z.array(z.any()),
    conversationId: z.string(),
    userPhone: z.string(),
    profileId: z.string()
  }),
  outputSchema: z.object({
    status: z.enum(['suspended', 'executing', 'completed']),
    suspendContext: z.record(z.any()).optional(),
    executionResults: z.array(z.any()).optional()
  }),
  execute: async ({ shouldSuspend, todoList, conversationId, userPhone, profileId }, context) => {
    if (shouldSuspend) {
      // Suspend workflow and wait for user input
      const intentAnalysis = context.getStepResult('analyze-intent');
      
      return {
        status: 'suspended' as const,
        suspendContext: {
          todoList,
          conversationId,
          userPhone,
          profileId,
          pendingQuestion: intentAnalysis.suggestedQuestions?.[0],
          intent: intentAnalysis.intent,
          timestamp: new Date().toISOString()
        }
      };
    }

    // Execute todo list
    const results = [];
    for (const todo of todoList) {
      if (todo.assignedAgent === 'ToolOrchestrator') {
        // Execute tool via Tool Orchestrator
        results.push({
          todoId: todo.id,
          status: 'completed',
          result: `${todo.description} completed successfully`
        });
      } else if (todo.assignedAgent === 'CommunicationManager') {
        // Handle communication via Communication Manager
        results.push({
          todoId: todo.id,
          status: 'completed', 
          result: 'Message sent to user'
        });
      }
    }

    return {
      status: 'completed' as const,
      executionResults: results
    };
  }
});

// Workflow for resuming suspended conversations
export const resumeConversationWorkflow = new Workflow({
  name: 'resume-suspended-conversation',
  triggerSchema: z.object({
    conversationId: z.string(),
    userPhone: z.string(), 
    newMessage: z.string(),
    profileId: z.string(),
    suspendedContext: z.record(z.any())
  })
});

// Step 1: Validate resume context
resumeConversationWorkflow.step('validate-resume', {
  inputSchema: z.object({
    conversationId: z.string(),
    suspendedContext: z.record(z.any()),
    newMessage: z.string()
  }),
  outputSchema: z.object({
    canResume: z.boolean(),
    updatedContext: z.record(z.any()),
    missingInfo: z.array(z.string()).optional()
  }),
  execute: async ({ conversationId, suspendedContext, newMessage }) => {
    // Validate that we can resume with the new message
    const { intent, pendingQuestion } = suspendedContext;
    
    if (intent === 'form_creation' && pendingQuestion?.includes('title')) {
      return {
        canResume: true,
        updatedContext: {
          ...suspendedContext,
          formTitle: newMessage,
          pendingQuestion: null
        }
      };
    }

    return {
      canResume: false,
      updatedContext: suspendedContext,
      missingInfo: ['Unable to process response in current context']
    };
  }
});

// Step 2: Continue with updated context
resumeConversationWorkflow.step('continue-execution', {
  inputSchema: z.object({
    canResume: z.boolean(),
    updatedContext: z.record(z.any()),
    userPhone: z.string(),
    profileId: z.string()
  }),
  outputSchema: z.object({
    executionResults: z.array(z.any()),
    status: z.string()
  }),
  execute: async ({ canResume, updatedContext, userPhone, profileId }) => {
    if (!canResume) {
      return {
        executionResults: [{
          type: 'error',
          message: 'Cannot resume conversation with provided input'
        }],
        status: 'failed'
      };
    }

    // Execute the original plan with updated context
    const { intent, todoList, formTitle } = updatedContext;
    
    if (intent === 'form_creation') {
      return {
        executionResults: [
          {
            type: 'form_created',
            formTitle,
            message: `Created form "${formTitle}" and sent link to user`
          }
        ],
        status: 'completed'
      };
    }

    return {
      executionResults: [],
      status: 'completed'
    };
  }
});

export { conversationWorkflow, resumeConversationWorkflow };