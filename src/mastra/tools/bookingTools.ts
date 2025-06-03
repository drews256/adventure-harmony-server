import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createPatchedStreamableHTTPTransport } from '../../utils/patched-streamable-http.js';

// Helper function to create and connect MCP client
async function createMCPClient() {
  const mcpClient = new Client({
    name: 'booking-tools-client',
    version: '1.0.0'
  }, {
    capabilities: {}
  });
  
  const transport = createPatchedStreamableHTTPTransport(
    new URL(process.env.MCP_SERVER_URL || 'https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com/mcp')
  );
  
  await mcpClient.connect(transport);
  return mcpClient;
}

// Tool for checking availability
export const checkAvailabilityTool = createTool({
  id: 'check-availability',
  description: 'Check availability for a product or service on a specific date',
  inputSchema: z.object({
    api: z.enum(['goguide', 'octo']).describe('Which API to use'),
    productId: z.string().describe('Product or listing ID'),
    date: z.string().describe('Date to check (YYYY-MM-DD)'),
    partySize: z.number().optional().describe('Number of people'),
    duration: z.number().optional().describe('Duration in hours (for rentals)')
  }),
  execute: async ({ context }) => {
    const { api, productId, date, partySize, duration } = context;
    const mcpClient = await createMCPClient();
    
    try {
      if (api === 'goguide') {
        // Call GoGuide availability endpoint
        const result = await mcpClient.callTool({
          name: 'goguide_get_listing_availability',
          arguments: {
            listingId: productId,
            date: date,
            partySize: partySize
          }
        });
        
        const content = (result as any).content?.[0];
        const availableSlots = content?.availableSlots || [];
        return {
          available: availableSlots.length > 0,
          slots: availableSlots,
          message: availableSlots.length > 0 
            ? `Found ${availableSlots.length} available time slots`
            : 'No availability found for this date'
        };
      } else {
        // Call OCTO availability endpoint
        const result = await mcpClient.callTool({
          name: 'octo_get_availability',
          arguments: {
            productId: productId,
            localDate: date,
            units: partySize ? [{ id: 'adult', quantity: partySize }] : undefined
          }
        });
        
        const content = (result as any).content?.[0];
        const items = content?.items || [];
        return {
          available: items.length > 0,
          slots: items,
          message: items.length > 0
            ? `Found ${items.length} available options`
            : 'No availability found for this date'
        };
      }
    } catch (error) {
      return {
        available: false,
        slots: [],
        message: `Error checking availability: ${error instanceof Error ? error.message : String(error)}`
      };
    } finally {
      await mcpClient.close();
    }
  }
});

// Tool for creating a booking
export const createBookingTool = createTool({
  id: 'create-booking',
  description: 'Create a new booking reservation',
  inputSchema: z.object({
    api: z.enum(['goguide', 'octo']).describe('Which API to use'),
    bookingData: z.record(z.any()).describe('Booking data specific to the API')
  }),
  execute: async ({ context }) => {
    const { api, bookingData } = context;
    const mcpClient = await createMCPClient();
    
    try {
      if (api === 'goguide') {
        // Create GoGuide order
        const result = await mcpClient.callTool({
          name: 'goguide_create_order',
          arguments: {
            customerId: bookingData.customerId,
            lineItems: [{
              vendorId: bookingData.vendorId,
              listingId: bookingData.listingId,
              scheduleId: bookingData.scheduleId,
              startAt: bookingData.startAt,
              endAt: bookingData.endAt,
              durationInHours: bookingData.durationInHours,
              customerCount: bookingData.customerCount,
              unitPrice: bookingData.unitPrice,
              notes: bookingData.notes || ''
            }],
            bookingSource: 80 // Plugin source
          }
        });
        
        const content = (result as any).content?.[0];
        return {
          success: true,
          bookingId: content?.orderId,
          confirmationNumber: content?.confirmationNumber,
          message: `Booking created successfully! Confirmation #${content?.confirmationNumber}`
        };
      } else {
        // Create OCTO booking
        const result = await mcpClient.callTool({
          name: 'octo_create_booking',
          arguments: {
            productId: bookingData.productId,
            optionId: bookingData.optionId,
            availabilityId: bookingData.availabilityId,
            unitItems: bookingData.unitItems,
            notes: bookingData.notes,
            expirationMinutes: bookingData.expirationMinutes || 30
          }
        });
        
        const content = (result as any).content?.[0];
        return {
          success: true,
          bookingId: content?.uuid,
          confirmationNumber: content?.reference,
          message: `Booking created! Reference: ${content?.reference}. Please confirm within ${bookingData.expirationMinutes || 30} minutes.`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: `Failed to create booking: ${error instanceof Error ? error.message : String(error)}. Please check your details and try again.`
      };
    } finally {
      await mcpClient.close();
    }
  }
});

// Tool for updating a booking
export const updateBookingTool = createTool({
  id: 'update-booking',
  description: 'Update an existing booking',
  inputSchema: z.object({
    api: z.enum(['goguide', 'octo']),
    bookingId: z.string().describe('Booking/Order ID'),
    updates: z.record(z.any()).describe('Fields to update')
  }),
  execute: async ({ context }) => {
    const { api, bookingId, updates } = context;
    const mcpClient = await createMCPClient();
    
    try {
      if (api === 'goguide') {
        const result = await mcpClient.callTool({
          name: 'goguide_update_order',
          arguments: {
            orderId: bookingId,
            ...updates
          }
        });
        
        return {
          success: true,
          message: 'Booking updated successfully'
        };
      } else {
        // OCTO doesn't have a direct update endpoint, might need to cancel and recreate
        return {
          success: false,
          message: 'OCTO bookings cannot be directly updated. Please cancel and create a new booking.'
        };
      }
    } finally {
      await mcpClient.close();
    }
  }
});

// Tool for getting booking details
export const getBookingDetailsTool = createTool({
  id: 'get-booking-details',
  description: 'Retrieve details of an existing booking',
  inputSchema: z.object({
    api: z.enum(['goguide', 'octo']),
    bookingId: z.string().describe('Booking/Order ID')
  }),
  execute: async ({ context }) => {
    const { api, bookingId } = context;
    const mcpClient = await createMCPClient();
    
    try {
      if (api === 'goguide') {
        const result = await mcpClient.callTool({
          name: 'goguide_get_order',
          arguments: {
            orderId: bookingId
          }
        });
        
        const content = (result as any).content?.[0];
        return {
          success: true,
          booking: content,
          message: `Booking ${content?.confirmationNumber} - Status: ${content?.status}`
        };
      } else {
        const result = await mcpClient.callTool({
          name: 'octo_get_booking',
          arguments: {
            uuid: bookingId
          }
        });
        
        const content = (result as any).content?.[0];
        return {
          success: true,
          booking: content,
          message: `Booking ${content?.reference} - Status: ${content?.status}`
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Error retrieving booking: ${error instanceof Error ? error.message : String(error)}`
      };
    } finally {
      await mcpClient.close();
    }
  }
});

// Tool for listing available products
export const listProductsTool = createTool({
  id: 'list-products',
  description: 'List available products, tours, or services',
  inputSchema: z.object({
    api: z.enum(['goguide', 'octo']),
    category: z.string().optional().describe('Product category filter'),
    location: z.string().optional().describe('Location filter')
  }),
  execute: async ({ context }) => {
    const { api, category, location } = context;
    const mcpClient = await createMCPClient();
    
    try {
      if (api === 'goguide') {
        const result = await mcpClient.callTool({
          name: 'goguide_search_listings',
          arguments: {
            category: category,
            location: location
          }
        });
        
        const content = (result as any).content?.[0];
        const listings = content?.listings || [];
        return {
          success: true,
          products: listings,
          message: `Found ${listings.length} available products`
        };
      } else {
        const result = await mcpClient.callTool({
          name: 'octo_get_products',
          arguments: {}
        });
        
        const content = (result as any).content?.[0];
        const products = content?.products || [];
        return {
          success: true,
          products: products,
          message: `Found ${products.length} available products`
        };
      }
    } catch (error) {
      return {
        success: false,
        products: [],
        message: `Error listing products: ${error instanceof Error ? error.message : String(error)}`
      };
    } finally {
      await mcpClient.close();
    }
  }
});

// Tool for calculating pricing
export const calculatePricingTool = createTool({
  id: 'calculate-pricing',
  description: 'Calculate total pricing for a booking',
  inputSchema: z.object({
    api: z.enum(['goguide', 'octo']),
    productId: z.string(),
    partySize: z.number(),
    date: z.string().optional(),
    options: z.record(z.any()).optional()
  }),
  execute: async ({ context }) => {
    const { api, productId, partySize, date, options } = context;
    const mcpClient = await createMCPClient();
    
    try {
      // This would call appropriate pricing endpoints
      // For now, returning a mock calculation
      const basePrice = 50; // Would come from product details
      const total = basePrice * partySize;
      
      return {
        success: true,
        pricing: {
          unitPrice: basePrice,
          quantity: partySize,
          subtotal: total,
          taxes: total * 0.1,
          total: total * 1.1
        },
        message: `Total price for ${partySize} people: $${(total * 1.1).toFixed(2)}`
      };
    } finally {
      await mcpClient.close();
    }
  }
});