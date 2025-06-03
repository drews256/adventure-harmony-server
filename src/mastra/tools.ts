import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { SMSTool } from '../services/sms-tool';
import { FormGenerator } from '../services/form-generator';
import { CalendarTool } from '../services/calendar-tool';
import { createClient } from '@supabase/supabase-js';
import {
  checkAvailabilityTool,
  createBookingTool,
  updateBookingTool,
  getBookingDetailsTool,
  listProductsTool,
  calculatePricingTool
} from './tools/bookingTools';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// SMS Tool for Mastra
export const smsToolMastra = createTool({
  id: "send_sms",
  description: "Send SMS messages to users with phone number validation",
  inputSchema: z.object({
    to: z.string().describe("Phone number to send SMS to (with country code, e.g., +1234567890)"),
    message: z.string().describe("Message content to send"),
    fromName: z.string().optional().describe("Name to send from (default: Adventure Harmony)")
  }),
  execute: async ({ context }) => {
    const { to, message, fromName } = context;
    const smsTool = new SMSTool(supabase);
    
    try {
      const result = await smsTool.sendSMS({ to, message, fromName });
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
});

// Form Generator Tool for Mastra
export const formGeneratorToolMastra = createTool({
  id: "create_form",
  description: "Create dynamic forms for data collection that customers can fill out via a link",
  inputSchema: z.object({
    formTitle: z.string().describe("Title displayed at the top of the form"),
    formType: z.string().describe("Type of form (e.g., 'booking', 'inquiry', 'feedback')"),
    fields: z.array(z.object({
      name: z.string().describe("Field name/ID"),
      label: z.string().describe("Label shown to user"),
      type: z.enum(['text', 'email', 'phone', 'number', 'select', 'textarea', 'checkbox']).describe("Field input type"),
      required: z.boolean().default(false).describe("Whether field is required"),
      options: z.array(z.string()).optional().describe("Options for select fields")
    })).min(1).describe("Array of form fields to include"),
    profileId: z.string().describe("Profile ID of the business owner creating this form"),
    description: z.string().optional().describe("Optional form description"),
    expiresInHours: z.number().optional().describe("How many hours until form expires")
  }),
  execute: async ({ context }) => {
    const { formTitle, formType, fields, profileId, description, expiresInHours } = context;
    const formGen = new FormGenerator(supabase);
    
    try {
      const result = await formGen.createForm({
        formTitle,
        formType,
        fields,
        originatingProfileId: profileId,
        expiresInHours
      });
      
      return {
        success: true,
        formId: result.formId,
        formUrl: result.url,
        expiresAt: result.expiresAt
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
});

// Calendar Display Tool for Mastra
export const calendarToolMastra = createTool({
  id: "create_calendar_display",
  description: "Create a mobile-optimized calendar display from event data",
  inputSchema: z.object({
    events: z.array(z.object({
      id: z.string(),
      title: z.string(),
      startDate: z.string(),
      endDate: z.string(),
      description: z.string().optional(),
      location: z.string().optional()
    })).describe("Array of events to display"),
    title: z.string().optional().describe("Calendar title"),
    timezone: z.string().optional().describe("Timezone for display")
  }),
  execute: async ({ context }) => {
    const { events, title, timezone } = context;
    const calTool = new CalendarTool(supabase);
    
    try {
      // Convert events to StandardizedEvent format
      const standardizedEvents = events.map(event => ({
        id: event.id,
        title: event.title,
        start: event.startDate,
        end: event.endDate,
        description: event.description,
        location: event.location,
        allDay: false
      }));
      
      const result = await calTool.createCalendar({
        events: standardizedEvents,
        title,
        timezone
      });
      
      return {
        success: true,
        calendarUrl: result.url,
        icalUrl: result.icalUrl,
        eventCount: result.eventCount
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
});

// Combined Form Creation and SMS Notification Tool
export const formWithSMSToolMastra = createTool({
  id: "create_form_and_send_link",
  description: "Create a form and automatically send the link to a customer via SMS",
  inputSchema: z.object({
    formTitle: z.string().describe("Title for the form"),
    formType: z.string().describe("Type of form being created"),
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      type: z.enum(['text', 'email', 'phone', 'number', 'select', 'textarea', 'checkbox']),
      required: z.boolean().default(false),
      options: z.array(z.string()).optional()
    })).min(1),
    customerPhone: z.string().describe("Customer's phone number to send the form link"),
    profileId: z.string().describe("Business profile ID"),
    businessName: z.string().optional().describe("Business name for SMS message")
  }),
  execute: async ({ context }) => {
    const { formTitle, formType, fields, customerPhone, profileId, businessName } = context;
    
    try {
      // Step 1: Create the form
      const formGen = new FormGenerator(supabase);
      const formResult = await formGen.createForm({
        formTitle,
        formType,
        fields,
        originatingProfileId: profileId,
        customerPhone
      });
      
      // Step 2: Send SMS with form link
      const smsTool = new SMSTool(supabase);
      const smsResult = await smsTool.sendFormLink(
        customerPhone,
        formResult.url,
        formTitle,
        businessName
      );
      
      return {
        success: true,
        formId: formResult.formId,
        formUrl: formResult.url,
        smsMessageId: smsResult.messageId,
        message: `Form "${formTitle}" created and link sent to ${customerPhone}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
});

// Export all tools as a collection
export const mastraTools = {
  sms: smsToolMastra,
  formGenerator: formGeneratorToolMastra,
  calendar: calendarToolMastra,
  formWithSMS: formWithSMSToolMastra,
  // Booking tools
  checkAvailability: checkAvailabilityTool,
  createBooking: createBookingTool,
  updateBooking: updateBookingTool,
  getBookingDetails: getBookingDetailsTool,
  listProducts: listProductsTool,
  calculatePricing: calculatePricingTool
};