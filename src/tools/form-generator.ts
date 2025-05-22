import { createTool } from 'mastra';
import { z } from 'zod';
import { FormGenerator } from '../services/form-generator';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const formGeneratorTools = {
  createForm: createTool({
    id: 'create_form',
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
    outputSchema: z.object({
      success: z.boolean(),
      formId: z.string().optional(),
      formUrl: z.string().optional(),
      error: z.string().optional()
    }),
    execute: async ({ title, description, fields, profileId }) => {
      try {
        const formGen = new FormGenerator(supabase);
        const result = await formGen.createForm({
          title,
          description,
          fields,
          profile_id: profileId
        });
        
        return {
          success: true,
          formId: result.id,
          formUrl: result.url
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  }),

  getFormResponses: createTool({
    id: 'get_form_responses',
    description: 'Get responses for a specific form',
    inputSchema: z.object({
      formId: z.string().uuid(),
      profileId: z.string().uuid()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      responses: z.array(z.any()).optional(),
      error: z.string().optional()
    }),
    execute: async ({ formId, profileId }) => {
      try {
        const { data: responses, error } = await supabase
          .from('form_responses')
          .select('*')
          .eq('form_id', formId)
          .eq('profile_id', profileId);

        if (error) throw error;

        return {
          success: true,
          responses: responses || []
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