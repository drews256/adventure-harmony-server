import { Agent } from 'mastra';
import { z } from 'zod';

export const supervisorAgent = new Agent({
  name: "SupervisorAgent",
  instructions: `You are the Supervisor Agent responsible for managing other agents and coordinating complex tasks.

Your responsibilities:
1. Break down user requests into actionable tasks
2. Create and manage todo lists for multi-step operations
3. Coordinate between the Tool Orchestrator and Communication Manager
4. Track progress and ensure all tasks are completed
5. Handle error recovery and retry logic
6. Decide when to suspend workflows (e.g., waiting for user input via SMS)

When a user message comes in:
1. Analyze the request and determine what needs to be done
2. Create a todo list if it's a multi-step task
3. Delegate appropriate tasks to other agents
4. Monitor progress and coordinate next steps
5. Decide if workflow should be suspended pending user response

Available agents to coordinate:
- ToolOrchestrator: Handles all tool execution (SMS, forms, calendar, etc.)
- CommunicationManager: Manages SMS conversations and user interactions

Always think step-by-step and maintain a clear action plan.`,

  model: {
    provider: 'ANTHROPIC',
    name: 'claude-3-haiku-20240307',
    toolChoice: 'auto'
  },

  tools: []
});

// Supervisor's internal todo management tool
export const createTodoTool = {
  id: 'create_todo_list',
  description: 'Create a todo list for multi-step tasks',
  inputSchema: z.object({
    conversationId: z.string(),
    userRequest: z.string(),
    todoItems: z.array(z.object({
      id: z.string(),
      description: z.string(),
      status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
      assignedAgent: z.enum(['ToolOrchestrator', 'CommunicationManager', 'Supervisor']),
      dependencies: z.array(z.string()).optional()
    }))
  }),
  execute: async ({ conversationId, userRequest, todoItems }) => {
    // Store todo list in memory with conversation context
    return {
      success: true,
      todoListId: `todo_${conversationId}_${Date.now()}`,
      items: todoItems
    };
  }
};

export const updateTodoTool = {
  id: 'update_todo_item',
  description: 'Update status of a todo item',
  inputSchema: z.object({
    todoListId: z.string(),
    itemId: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    result: z.any().optional()
  }),
  execute: async ({ todoListId, itemId, status, result }) => {
    // Update todo item status in memory
    return {
      success: true,
      updatedItem: { id: itemId, status, result }
    };
  }
};

export const delegateTaskTool = {
  id: 'delegate_task',
  description: 'Delegate a task to another agent',
  inputSchema: z.object({
    targetAgent: z.enum(['ToolOrchestrator', 'CommunicationManager']),
    task: z.object({
      id: z.string(),
      description: z.string(),
      parameters: z.record(z.any()),
      context: z.record(z.any()).optional()
    }),
    conversationId: z.string()
  }),
  execute: async ({ targetAgent, task, conversationId }) => {
    // This would trigger the appropriate agent's workflow
    return {
      success: true,
      delegatedTo: targetAgent,
      taskId: task.id
    };
  }
};