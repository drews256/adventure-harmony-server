#!/usr/bin/env node

/**
 * Standalone test for USA Pub Crawl booking with different ticket structures
 * 
 * Usage:
 *   OCTO_API_TOKEN=your-token MCP_SERVER_URL=http://localhost:3001 node test-usa-pub-crawl.js
 */

const fetch = require('node-fetch');

// Configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001';
const OCTO_API_TOKEN = process.env.OCTO_API_TOKEN;

// Simple UUID v4 generator
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

if (!OCTO_API_TOKEN) {
  console.error('❌ Error: OCTO_API_TOKEN environment variable is required');
  console.error('Usage: OCTO_API_TOKEN=your-token node test-usa-pub-crawl.js');
  process.exit(1);
}

// Helper function to call MCP tools
async function callMCPTool(toolName, args) {
  console.log(`\n📞 Calling ${toolName}...`);
  
  const requestBody = {
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
  };

  console.log('Request:', JSON.stringify(requestBody, null, 2));

  const response = await fetch(`${MCP_SERVER_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json();
  
  if (result.error) {
    throw new Error(`MCP Error: ${JSON.stringify(result.error)}`);
  }
  
  return JSON.parse(result.result.content[0].text);
}

async function runTest() {
  try {
    console.log('🧪 USA Pub Crawl Booking Test');
    console.log('============================');
    console.log(`MCP Server: ${MCP_SERVER_URL}`);
    console.log(`Token: ${OCTO_API_TOKEN.substring(0, 10)}...`);

    // Step 1: Find USA Pub Crawl product
    console.log('\n📍 Step 1: Finding USA Pub Crawl product...');
    const products = await callMCPTool('octo_list_products', {
      'Octo-Capabilities': 'octo/content',
    });

    const pubCrawl = products.find(p => 
      p.internalName?.toLowerCase().includes('pub crawl') ||
      p.title?.toLowerCase().includes('pub crawl') ||
      p.name?.toLowerCase().includes('pub crawl')
    );

    if (!pubCrawl) {
      throw new Error('USA Pub Crawl product not found!');
    }

    const productId = pubCrawl.id;
    const optionId = pubCrawl.options?.[0]?.id || 'DEFAULT';
    const unitIds = pubCrawl.options?.[0]?.units?.map(u => u.id) || [];

    console.log('\n✅ Found USA Pub Crawl:');
    console.log(`   Product ID: ${productId}`);
    console.log(`   Product Name: ${pubCrawl.internalName}`);
    console.log(`   Option ID: ${optionId}`);
    console.log(`   Unit IDs: ${JSON.stringify(unitIds)}`);
    console.log(`   Units Details:`);
    pubCrawl.options?.[0]?.units?.forEach(unit => {
      console.log(`     - ${unit.id}: ${unit.internalName} (${unit.type})`);
    });

    // Step 2: Check availability
    console.log('\n📅 Step 2: Checking availability for tomorrow...');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const availability = await callMCPTool('octo_check_availability', {
      productId,
      optionId,
      localDateStart: dateStr,
      localDateEnd: dateStr,
      units: [{
        id: unitIds[0],
        quantity: 2,
      }],
      'Octo-Capabilities': 'octo/content',
    });

    console.log('\n📋 Availability response:');
    console.log(JSON.stringify(availability.slice(0, 3), null, 2)); // Show first 3 slots

    const availableSlot = availability.find(slot => slot.available);
    if (!availableSlot) {
      throw new Error('No available slots found!');
    }

    const availabilityId = availableSlot.id;
    console.log(`\n✅ Found available slot: ${availabilityId}`);

    // Step 3: Try different booking structures
    console.log('\n🎫 Step 3: Testing booking structures...');
    
    const baseBookingData = {
      productId,
      optionId,
      availabilityId,
      notes: 'Test booking for USA Pub Crawl debugging',
      'Octo-Capabilities': 'octo/content',
    };

    const structures = [
      {
        name: 'Correct unitItems format (2 tickets)',
        unitItems: [
          { unitId: unitIds[0] },
          { unitId: unitIds[0] },
        ],
      },
      {
        name: 'unitItems with UUID for idempotency',
        unitItems: [
          { unitId: unitIds[0], uuid: generateUUID() },
          { unitId: unitIds[0], uuid: generateUUID() },
        ],
      },
      {
        name: 'Single unitItem',
        unitItems: [
          { unitId: unitIds[0] },
        ],
      },
      {
        name: 'Three unitItems',
        unitItems: [
          { unitId: unitIds[0] },
          { unitId: unitIds[0] },
          { unitId: unitIds[0] },
        ],
      },
    ];

    for (let i = 0; i < structures.length; i++) {
      const structure = structures[i];
      console.log(`\n🔄 Attempt ${i + 1}: ${structure.name}`);
      
      try {
        const bookingData = {
          ...baseBookingData,
          ...structure,
        };
        
        console.log('Booking request units:', JSON.stringify(bookingData.units, null, 2));
        if (bookingData.tickets) {
          console.log('Booking request tickets:', JSON.stringify(bookingData.tickets, null, 2));
        }
        
        const booking = await callMCPTool('octo_create_booking', bookingData);
        
        console.log(`\n🎉 SUCCESS with structure: ${structure.name}`);
        console.log('Booking response:', JSON.stringify(booking, null, 2));
        
        // If successful, we can stop
        return;
        
      } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
        
        // Extract detailed error if available
        if (error.message.includes('errorMessage')) {
          try {
            const errorData = JSON.parse(error.message.replace('MCP Error: ', ''));
            console.log(`   Error details: ${errorData.message || JSON.stringify(errorData)}`);
          } catch (e) {
            // Ignore parsing errors
          }
        }
      }
    }

    console.log('\n❌ All booking structures failed!');
    console.log('The USA Pub Crawl may have specific requirements not covered by these structures.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
runTest().then(() => {
  console.log('\n✅ Test completed');
}).catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});