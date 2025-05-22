import { createTool } from 'mastra';
import { z } from 'zod';
import { CalendarTool } from '../services/calendar-tool';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const calendarTools = {
  searchEvents: createTool({
    id: 'search_calendar_events',
    description: 'Search and retrieve calendar events',
    inputSchema: z.object({
      query: z.string().min(1),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      profileId: z.string().uuid()
    }),
    outputSchema: z.object({
      success: z.boolean(),
      events: z.array(z.any()).optional(),
      summary: z.string().optional(),
      error: z.string().optional()
    }),
    execute: async ({ query, startDate, endDate, profileId }) => {
      try {
        const calTool = new CalendarTool(supabase);
        const result = await calTool.search({
          args: { query, start_date: startDate, end_date: endDate, profile_id: profileId }
        });
        
        const events = result.events || [];
        const summary = events.length > 0
          ? `Found ${events.length} events matching "${query}"`
          : `No events found matching "${query}"`;
        
        return {
          success: true,
          events,
          summary
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
  }),

  getUpcomingEvents: createTool({
    id: 'get_upcoming_events',
    description: 'Get upcoming calendar events',
    inputSchema: z.object({
      profileId: z.string().uuid(),
      days: z.number().min(1).max(30).default(7)
    }),
    outputSchema: z.object({
      success: z.boolean(),
      events: z.array(z.any()).optional(),
      error: z.string().optional()
    }),
    execute: async ({ profileId, days }) => {
      try {
        const calTool = new CalendarTool(supabase);
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);
        
        const result = await calTool.search({
          args: {
            query: '',
            start_date: new Date().toISOString(),
            end_date: endDate.toISOString(),
            profile_id: profileId
          }
        });
        
        return {
          success: true,
          events: result.events || []
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