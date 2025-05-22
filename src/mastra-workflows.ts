import { Workflow, Step } from 'mastra';
import { z } from 'zod';
import { smsToolMastra, formGeneratorToolMastra, calendarToolMastra } from './mastra-config';

// Form creation and notification workflow
export const formCreationWorkflow = new Workflow({
  name: 'form-creation-and-notification',
  triggerSchema: z.object({
    userPhone: z.string(),
    formRequest: z.object({
      title: z.string(),
      description: z.string().optional(),
      fields: z.array(z.object({
        name: z.string(),
        type: z.enum(['text', 'email', 'phone', 'number', 'select', 'textarea', 'checkbox']),
        label: z.string(),
        required: z.boolean().default(false),
        options: z.array(z.string()).optional()
      })),
      profileId: z.string().uuid()
    })
  })
});

// Step 1: Create the form
formCreationWorkflow.step('create-form', {
  inputSchema: z.object({
    formRequest: z.object({
      title: z.string(),
      description: z.string().optional(),
      fields: z.array(z.any()),
      profileId: z.string().uuid()
    })
  }),
  outputSchema: z.object({
    formId: z.string(),
    formUrl: z.string(),
    success: z.boolean()
  }),
  execute: async ({ formRequest }) => {
    const result = await formGeneratorToolMastra.execute(formRequest);
    return {
      formId: result.id,
      formUrl: result.url,
      success: true
    };
  }
});

// Step 2: Send form link via SMS
formCreationWorkflow.step('send-form-link', {
  inputSchema: z.object({
    userPhone: z.string(),
    formUrl: z.string(),
    profileId: z.string().uuid()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    messageId: z.string().optional()
  }),
  execute: async ({ userPhone, formUrl, profileId }) => {
    const message = `Your form has been created! Fill it out here: ${formUrl}`;
    const result = await smsToolMastra.execute({
      to: userPhone,
      message,
      profileId
    });
    return {
      success: true,
      messageId: result.id
    };
  }
});

// Calendar event workflow with smart responses
export const calendarQueryWorkflow = new Workflow({
  name: 'calendar-query-and-response',
  triggerSchema: z.object({
    userPhone: z.string(),
    query: z.string(),
    profileId: z.string().uuid(),
    dateRange: z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional()
    }).optional()
  })
});

// Step 1: Search calendar
calendarQueryWorkflow.step('search-calendar', {
  inputSchema: z.object({
    query: z.string(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    profileId: z.string().uuid()
  }),
  outputSchema: z.object({
    events: z.array(z.any()),
    summary: z.string()
  }),
  execute: async ({ query, startDate, endDate, profileId }) => {
    const result = await calendarToolMastra.execute({
      query,
      startDate,
      endDate,
      profileId
    });
    
    const summary = result.events.length > 0
      ? `Found ${result.events.length} events matching "${query}"`
      : `No events found matching "${query}"`;
    
    return {
      events: result.events,
      summary
    };
  }
});

// Step 2: Send calendar results
calendarQueryWorkflow.step('send-calendar-response', {
  inputSchema: z.object({
    userPhone: z.string(),
    events: z.array(z.any()),
    summary: z.string(),
    profileId: z.string().uuid()
  }),
  outputSchema: z.object({
    success: z.boolean()
  }),
  execute: async ({ userPhone, events, summary, profileId }) => {
    let message = summary;
    
    if (events.length > 0) {
      const eventList = events.slice(0, 3).map(event => 
        `• ${event.title} - ${event.date}`
      ).join('\n');
      message += `:\n\n${eventList}`;
      
      if (events.length > 3) {
        message += `\n\n...and ${events.length - 3} more events.`;
      }
    }
    
    await smsToolMastra.execute({
      to: userPhone,
      message,
      profileId
    });
    
    return { success: true };
  }
});

// Multi-step conversation workflow
export const conversationWorkflow = new Workflow({
  name: 'intelligent-conversation',
  triggerSchema: z.object({
    userPhone: z.string(),
    message: z.string(),
    profileId: z.string().uuid(),
    conversationContext: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string()
    })).optional()
  })
});

// Step 1: Analyze intent and determine tools needed
conversationWorkflow.step('analyze-intent', {
  inputSchema: z.object({
    message: z.string(),
    conversationContext: z.array(z.any()).optional()
  }),
  outputSchema: z.object({
    intent: z.enum(['form_creation', 'calendar_query', 'general_response']),
    confidence: z.number(),
    extractedParams: z.record(z.any())
  }),
  execute: async ({ message, conversationContext }) => {
    // Simple intent detection - in production this would use Claude
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('form') || lowerMessage.includes('create') || lowerMessage.includes('survey')) {
      return {
        intent: 'form_creation' as const,
        confidence: 0.8,
        extractedParams: { type: 'form_request' }
      };
    }
    
    if (lowerMessage.includes('calendar') || lowerMessage.includes('event') || lowerMessage.includes('schedule')) {
      return {
        intent: 'calendar_query' as const,
        confidence: 0.8,
        extractedParams: { query: message }
      };
    }
    
    return {
      intent: 'general_response' as const,
      confidence: 0.6,
      extractedParams: {}
    };
  }
});

// Step 2: Execute appropriate workflow
conversationWorkflow.step('execute-workflow', {
  inputSchema: z.object({
    intent: z.enum(['form_creation', 'calendar_query', 'general_response']),
    userPhone: z.string(),
    message: z.string(),
    profileId: z.string().uuid(),
    extractedParams: z.record(z.any())
  }),
  outputSchema: z.object({
    success: z.boolean(),
    workflowUsed: z.string()
  }),
  execute: async ({ intent, userPhone, message, profileId, extractedParams }) => {
    switch (intent) {
      case 'form_creation':
        // Would trigger form creation workflow
        await smsToolMastra.execute({
          to: userPhone,
          message: "I'd be happy to help you create a form! What kind of information do you want to collect?",
          profileId
        });
        return { success: true, workflowUsed: 'form_creation' };
        
      case 'calendar_query':
        // Trigger calendar workflow
        await calendarQueryWorkflow.trigger({
          userPhone,
          query: extractedParams.query || message,
          profileId
        });
        return { success: true, workflowUsed: 'calendar_query' };
        
      default:
        // General response
        await smsToolMastra.execute({
          to: userPhone,
          message: "I understand you're looking for help. I can assist with creating forms or checking your calendar. What would you like to do?",
          profileId
        });
        return { success: true, workflowUsed: 'general_response' };
    }
  }
});

export { formCreationWorkflow, calendarQueryWorkflow, conversationWorkflow };