import { createTool } from 'mastra';
import { z } from 'zod';
import { SMSTool } from '../services/sms-tool';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const smsTools = {
  sendSMS: createTool({
    id: 'send_sms',
    description: 'Send SMS messages to users',
    inputSchema: z.object({
      to: z.string().min(10).max(15),
      message: z.string().min(1).max(1600),
      profileId: z.string().uuid()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      messageId: z.string().optional(),
      error: z.string().optional()
    }),
    execute: async ({ to, message, profileId }) => {
      try {
        const smsTool = new SMSTool(supabase);
        const result = await smsTool.send({
          args: { to, message, profile_id: profileId }
        });
        
        return {
          success: true,
          messageId: result.id
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  }),

  sendFormLink: createTool({
    id: 'send_form_link',
    description: 'Send form link via SMS',
    inputSchema: z.object({
      to: z.string().min(10).max(15),
      formUrl: z.string().url(),
      profileId: z.string().uuid(),
      formTitle: z.string().optional()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      messageId: z.string().optional(),
      error: z.string().optional()
    }),
    execute: async ({ to, formUrl, profileId, formTitle }) => {
      try {
        const smsTool = new SMSTool(supabase);
        const message = formTitle 
          ? `Your form "${formTitle}" is ready! Fill it out here: ${formUrl}`
          : `Your form has been created! Fill it out here: ${formUrl}`;
          
        const result = await smsTool.send({
          args: { to, message, profile_id: profileId }
        });
        
        return {
          success: true,
          messageId: result.id
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  })
};