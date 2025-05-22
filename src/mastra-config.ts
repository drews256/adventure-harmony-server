import { Mastra, createTool, Agent } from 'mastra';
import { z } from 'zod';
import { SMSTool } from './services/sms-tool';
import { FormGenerator } from './services/form-generator';
import { CalendarTool } from './services/calendar-tool';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Create Mastra tools from existing services
export const smsToolMastra = createTool({
  id: 'sms_send',
  description: 'Send SMS messages to users',
  inputSchema: z.object({
    to: z.string().min(10).max(15),
    message: z.string().min(1).max(1600),
    profileId: z.string().uuid()
  }),
  execute: async ({ to, message, profileId }) => {
    const smsTool = new SMSTool(supabase);
    return await smsTool.sendMessage({ to, message, profileId });
  }
});

export const formGeneratorToolMastra = createTool({
  id: 'form_create',
  description: 'Create dynamic forms for data collection',
  inputSchema: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    fields: z.array(z.object({
      name: z.string(),
      type: z.enum(['text', 'email', 'phone', 'number', 'select', 'textarea', 'checkbox']),
      label: z.string(),
      required: z.boolean().default(false),
      options: z.array(z.string()).optional()
    })).min(1),
    profileId: z.string().uuid()
  }),
  execute: async ({ title, description, fields, profileId }) => {
    const formGen = new FormGenerator(supabase);
    return await formGen.createForm({ title, description, fields, profileId });
  }
});

export const calendarToolMastra = createTool({
  id: 'calendar_search',
  description: 'Search and retrieve calendar events',
  inputSchema: z.object({
    query: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    profileId: z.string().uuid()
  }),
  execute: async ({ query, startDate, endDate, profileId }) => {
    const calTool = new CalendarTool(supabase);
    return await calTool.searchEvents({ query, startDate, endDate, profileId });
  }
});

// Create message processing agent
export const messageProcessingAgent = new Agent({
  name: 'MessageProcessor',
  instructions: `You are a helpful assistant that processes user messages and uses available tools to respond appropriately.

Available tools:
- sms_send: Send SMS messages to users
- form_create: Create dynamic forms for data collection
- calendar_search: Search and retrieve calendar events

When a user requests form creation, use the form_create tool and then send them the form link via SMS.
When users ask about events or schedules, use the calendar_search tool.
Always be helpful and use the appropriate tools based on the user's request.`,
  model: {
    provider: 'ANTHROPIC',
    name: 'claude-3-haiku-20240307',
    toolChoice: 'auto'
  },
  tools: [smsToolMastra, formGeneratorToolMastra, calendarToolMastra]
});

// Initialize Mastra instance
export const mastra = new Mastra({
  agents: [messageProcessingAgent],
  tools: [smsToolMastra, formGeneratorToolMastra, calendarToolMastra]
});