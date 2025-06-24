import { describe, it, expect } from '@jest/globals';
import fetch from 'node-fetch';
import crypto from 'crypto';

// Test configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';
const OCTO_API_TOKEN = process.env.OCTO_API_TOKEN || 'your-test-token';

describe('OCTO USA Pub Crawl Booking Test', () => {
  let productId: string;
  let optionId: string;
  let unitIds: string[] = [];
  let availabilityId: string;

  // Helper function to make MCP calls
  async function callMCPTool(toolName: string, args: any) {
    const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: {
            ...args,
            authToken: OCTO_API_TOKEN,
          },
        },
        id: Date.now(),
      }),
    });

    const result = await response.json();
    if (result.error) {
      throw new Error(`MCP Error: ${JSON.stringify(result.error)}`);
    }
    return JSON.parse(result.result.content[0].text);
  }

  it('should find USA Pub Crawl product', async () => {
    console.log('Step 1: Searching for USA Pub Crawl product...');
    
    const products = await callMCPTool('octo_list_products', {
      'Octo-Capabilities': 'octo/content',
    });

    // Find USA Pub Crawl
    const pubCrawl = products.find((p: any) => 
      p.internalName?.toLowerCase().includes('pub crawl') ||
      p.title?.toLowerCase().includes('pub crawl')
    );

    expect(pubCrawl).toBeDefined();
    
    productId = pubCrawl.id;
    optionId = pubCrawl.options?.[0]?.id || 'DEFAULT';
    
    // Extract unit IDs
    if (pubCrawl.options?.[0]?.units) {
      unitIds = pubCrawl.options[0].units.map((u: any) => u.id);
    }

    console.log('Found USA Pub Crawl:');
    console.log(`- Product ID: ${productId}`);
    console.log(`- Option ID: ${optionId}`);
    console.log(`- Unit IDs: ${JSON.stringify(unitIds)}`);
    console.log(`- Units: ${JSON.stringify(pubCrawl.options?.[0]?.units, null, 2)}`);
  });

  it('should check availability for tomorrow', async () => {
    console.log('\nStep 2: Checking availability...');
    
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const availability = await callMCPTool('octo_check_availability', {
      productId,
      optionId,
      localDateStart: dateStr,
      localDateEnd: dateStr,
      units: [{
        id: unitIds[0], // Use first unit (usually adult)
        quantity: 2,
      }],
      'Octo-Capabilities': 'octo/content',
    });

    console.log('Availability response:', JSON.stringify(availability, null, 2));
    
    const availableSlot = availability.find((slot: any) => slot.available);
    expect(availableSlot).toBeDefined();
    
    availabilityId = availableSlot.id;
    console.log(`Found available slot with ID: ${availabilityId}`);
  });

  it('should create booking with different ticket structures', async () => {
    console.log('\nStep 3: Testing booking with different ticket structures...');
    
    const baseBookingData = {
      productId,
      optionId,
      availabilityId,
      notes: 'Test booking for USA Pub Crawl',
      'Octo-Capabilities': 'octo/content',
    };

    // Test Structure 1: Correct unitItems format (2 tickets)
    console.log('\nTrying Structure 1: Correct unitItems format (2 tickets)...');
    try {
      const booking1 = await callMCPTool('octo_create_booking', {
        ...baseBookingData,
        unitItems: [
          { unitId: unitIds[0] },
          { unitId: unitIds[0] },
        ],
      });
      console.log('✅ Structure 1 SUCCESS:', JSON.stringify(booking1, null, 2));
      return; // Success, no need to try other structures
    } catch (error: any) {
      console.log('❌ Structure 1 failed:', error.message);
    }

    // Test Structure 2: unitItems with UUID for idempotency
    console.log('\nTrying Structure 2: unitItems with UUID for idempotency...');
    try {
      const booking2 = await callMCPTool('octo_create_booking', {
        ...baseBookingData,
        unitItems: [
          { unitId: unitIds[0], uuid: crypto.randomUUID() },
          { unitId: unitIds[0], uuid: crypto.randomUUID() },
        ],
      });
      console.log('✅ Structure 2 SUCCESS:', JSON.stringify(booking2, null, 2));
      return;
    } catch (error: any) {
      console.log('❌ Structure 2 failed:', error.message);
    }

    // Test Structure 3: Single unitItem
    console.log('\nTrying Structure 3: Single unitItem...');
    try {
      const booking3 = await callMCPTool('octo_create_booking', {
        ...baseBookingData,
        unitItems: [
          { unitId: unitIds[0] },
        ],
      });
      console.log('✅ Structure 3 SUCCESS:', JSON.stringify(booking3, null, 2));
      return;
    } catch (error: any) {
      console.log('❌ Structure 3 failed:', error.message);
    }

    // Test Structure 4: Tickets as separate field
    console.log('\nTrying Structure 4: Tickets as separate field...');
    try {
      const booking4 = await callMCPTool('octo_create_booking', {
        ...baseBookingData,
        units: [{
          id: unitIds[0],
          quantity: 2,
        }],
        tickets: [
          { unitId: unitIds[0] },
          { unitId: unitIds[0] },
        ],
      });
      console.log('✅ Structure 4 SUCCESS:', JSON.stringify(booking4, null, 2));
      return;
    } catch (error: any) {
      console.log('❌ Structure 4 failed:', error.message);
    }

    // Test Structure 5: Detailed tickets with more fields
    console.log('\nTrying Structure 5: Detailed tickets...');
    try {
      const booking5 = await callMCPTool('octo_create_booking', {
        ...baseBookingData,
        units: [{
          id: unitIds[0],
          quantity: 2,
          tickets: [
            { 
              unitId: unitIds[0],
              firstName: 'John',
              lastName: 'Doe',
            },
            { 
              unitId: unitIds[0],
              firstName: 'Jane',
              lastName: 'Doe',
            },
          ],
        }],
      });
      console.log('✅ Structure 5 SUCCESS:', JSON.stringify(booking5, null, 2));
      return;
    } catch (error: any) {
      console.log('❌ Structure 5 failed:', error.message);
      throw new Error('All booking structures failed!');
    }
  });
});

// Run the test if this file is executed directly
if (require.main === module) {
  console.log('Running USA Pub Crawl booking test...');
  console.log('Make sure to set environment variables:');
  console.log('- MCP_SERVER_URL (default: http://localhost:3001)');
  console.log('- OCTO_API_TOKEN (your OCTO API token)');
}