import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { mastraTools } from '../tools';

// Booking state management
interface BookingContext {
  collectedFields: Record<string, any>;
  currentStep: 'gathering' | 'checking' | 'creating' | 'confirming';
  productDetails?: any;
  availabilityResults?: any;
  bookingId?: string;
}

export const bookingAgent = new Agent({
  name: 'BookingAssistant',
  instructions: `You are a specialized booking assistant that helps users create and manage bookings through GoGuide and OCTO APIs. Your approach should be:

  1. **Information Gathering Phase**:
     - Identify what type of booking the user wants (tour, activity, rental, etc.)
     - Collect essential information: date/time, number of people, contact details
     - If information is missing, ask for it conversationally or use forms
  
  2. **Product Selection**:
     - If the user doesn't specify a product, list available options
     - Help them choose based on their preferences and requirements
     - Provide clear pricing information
  
  3. **Availability Check**:
     - Always check availability before attempting to create a booking
     - If the requested time isn't available, suggest alternatives
     - Consider party size and resource constraints
  
  4. **Booking Creation**:
     - Gather all required fields before making the API call
     - For GoGuide: customerId, listingId, scheduleId, startAt, endAt, etc.
     - For OCTO: productId, optionId, availabilityId, unitItems
     - Handle multi-vendor scenarios appropriately
  
  5. **Confirmation and Follow-up**:
     - Provide clear confirmation with booking reference
     - Send confirmation via SMS if requested
     - Explain next steps (payment, arrival instructions, etc.)
  
  6. **Error Handling**:
     - If booking fails, explain why in user-friendly terms
     - Offer alternatives or solutions
     - Never leave the user confused about what happened
  
  Required Field Mapping:
  - For tours/activities: Product/Listing ID, Date, Time, Number of guests
  - For rentals: Resource ID, Start time, Duration, Quantity
  - For services: Service ID, Appointment time, Customer details
  
  Always maintain context throughout the conversation and remember previously collected information.`,
  
  model: anthropic('claude-3-haiku-20240307'),
  tools: {
    // Booking-specific tools
    check_availability: mastraTools.checkAvailability,
    create_booking: mastraTools.createBooking,
    update_booking: mastraTools.updateBooking,
    get_booking_details: mastraTools.getBookingDetails,
    list_products: mastraTools.listProducts,
    calculate_pricing: mastraTools.calculatePricing,
    // Communication tools
    send_sms: mastraTools.sms,
    create_form: mastraTools.formGenerator,
    create_form_and_send_link: mastraTools.formWithSMS
  }
});

// Helper function to extract booking intent and context
export function detectBookingIntent(message: string): boolean {
  const bookingKeywords = [
    'book', 'booking', 'reserve', 'reservation', 'schedule',
    'appointment', 'tour', 'activity', 'rental', 'ticket',
    'availability', 'available', 'slots', 'times'
  ];
  
  const lowerMessage = message.toLowerCase();
  return bookingKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Helper to parse booking requirements from natural language
export function parseBookingRequirements(message: string): BookingContext {
  const context: BookingContext = {
    collectedFields: {},
    currentStep: 'gathering'
  };
  
  // Extract date patterns
  const datePattern = /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4}|today|tomorrow|next\s+\w+day)\b/gi;
  const dateMatch = message.match(datePattern);
  if (dateMatch) {
    context.collectedFields.date = dateMatch[0];
  }
  
  // Extract time patterns
  const timePattern = /\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/gi;
  const timeMatch = message.match(timePattern);
  if (timeMatch) {
    context.collectedFields.time = timeMatch[0];
  }
  
  // Extract party size
  const partyPattern = /\b(\d+)\s*(?:people|persons?|guests?|pax|tickets?)\b/gi;
  const partyMatch = message.match(partyPattern);
  if (partyMatch) {
    const numbers = partyMatch[0].match(/\d+/);
    if (numbers) {
      context.collectedFields.partySize = parseInt(numbers[0]);
    }
  }
  
  // Extract duration for rentals
  const durationPattern = /\b(\d+)\s*(?:hours?|days?|minutes?)\b/gi;
  const durationMatch = message.match(durationPattern);
  if (durationMatch) {
    context.collectedFields.duration = durationMatch[0];
  }
  
  return context;
}

// Field validation schemas
export const bookingFieldSchemas = {
  goguide: z.object({
    customerId: z.number().describe('Customer ID (required)'),
    listingId: z.number().describe('Product/Service listing ID (required)'),
    scheduleId: z.number().optional().describe('Specific schedule slot ID'),
    startAt: z.string().datetime().describe('Start date and time (required)'),
    endAt: z.string().datetime().optional().describe('End date and time'),
    durationInHours: z.number().optional().describe('Duration in hours'),
    customerCount: z.number().min(1).describe('Number of customers (required)'),
    notes: z.string().optional().describe('Special requests or notes'),
    vendorId: z.number().optional().describe('Specific vendor ID')
  }),
  
  octo: z.object({
    productId: z.string().describe('Product ID (required)'),
    optionId: z.string().optional().describe('Product option ID'),
    availabilityId: z.string().optional().describe('Specific availability slot'),
    unitItems: z.array(z.object({
      unitId: z.string().describe('Unit type ID (required)'),
      quantity: z.number().min(1).optional()
    })).describe('Units to book (e.g., adult tickets, child tickets)'),
    notes: z.string().optional().describe('Booking notes'),
    expirationMinutes: z.number().optional().describe('Hold expiration time')
  })
};