import { Agent } from 'mastra';
import { z } from 'zod';
import { smsTools } from '../tools/sms';
import { formGeneratorTools } from '../tools/form-generator';
import { calendarTools } from '../tools/calendar';

export const toolOrchestratorAgent = new Agent({
  name: "ToolOrchestratorAgent",
  instructions: `You are the Tool Orchestrator Agent responsible for executing all tool calls and managing tool interactions.

Your responsibilities:
1. Execute tool calls based on requests from the Supervisor
2. Handle tool errors gracefully and report back to Supervisor
3. Coordinate multiple tool calls when needed (e.g., create form → send SMS link)
4. Validate tool inputs and outputs
5. Optimize tool execution order for efficiency
6. Handle tool retries and fallbacks

Available tools:
- SMS Tools: send_sms, send_form_link
- Form Tools: create_form, get_form_responses  
- Calendar Tools: search_calendar_events, get_upcoming_events

When executing tools:
1. Validate all inputs match tool schemas
2. Execute tools in the most efficient order
3. Handle any errors and report detailed results
4. Return structured results to the Supervisor
5. Suggest follow-up actions if needed

Always provide detailed execution reports including success/failure status, any errors, and next recommended steps.`,

  model: {
    provider: 'ANTHROPIC',
    name: 'claude-3-haiku-20240307',
    toolChoice: 'auto'
  },

  tools: [
    smsTools.sendSMS,
    smsTools.sendFormLink,
    formGeneratorTools.createForm,
    formGeneratorTools.getFormResponses,
    calendarTools.searchEvents,
    calendarTools.getUpcomingEvents
  ]
});

// Tool orchestration helper functions
export const executeToolSequenceTool = {
  id: 'execute_tool_sequence',
  description: 'Execute a sequence of tools in order',
  inputSchema: z.object({
    sequence: z.array(z.object({
      toolId: z.string(),
      parameters: z.record(z.any()),
      dependsOn: z.array(z.string()).optional() // IDs of previous steps this depends on
    })),
    conversationId: z.string(),
    profileId: z.string()
  }),
  execute: async ({ sequence, conversationId, profileId }) => {
    const results = [];
    const executionContext = new Map();

    for (const step of sequence) {
      try {
        // Check dependencies
        if (step.dependsOn) {
          for (const depId of step.dependsOn) {
            if (!executionContext.has(depId)) {
              throw new Error(`Dependency ${depId} not found for step ${step.toolId}`);
            }
          }
        }

        // Execute tool with enhanced parameters
        const enhancedParams = {
          ...step.parameters,
          profileId,
          conversationId
        };

        // Tool execution would happen here via the agent's tools
        const result = {
          stepId: step.toolId,
          success: true,
          result: enhancedParams, // Placeholder - actual tool execution
          timestamp: new Date().toISOString()
        };

        executionContext.set(step.toolId, result);
        results.push(result);

      } catch (error) {
        const errorResult = {
          stepId: step.toolId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        };
        results.push(errorResult);
        
        // Stop execution on error
        break;
      }
    }

    return {
      success: results.every(r => r.success),
      results,
      executionSummary: `Executed ${results.length}/${sequence.length} steps successfully`
    };
  }
};

export const validateToolInputsTool = {
  id: 'validate_tool_inputs',
  description: 'Validate inputs for tool execution',
  inputSchema: z.object({
    toolId: z.string(),
    inputs: z.record(z.any())
  }),
  execute: async ({ toolId, inputs }) => {
    // Validation logic would go here
    const validationResults = {
      valid: true,
      errors: [],
      sanitizedInputs: inputs
    };

    return validationResults;
  }
};