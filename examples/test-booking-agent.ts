/**
 * Test script to demonstrate the booking agent functionality
 */

import { mastra } from '../src/mastra/index';

async function testBookingAgent() {
  console.log('Testing Booking Agent...\n');

  // Test cases
  const testMessages = [
    {
      message: "I want to book a kayak tour for 2 people tomorrow",
      expected: "Should trigger booking agent and start gathering information"
    },
    {
      message: "Book tour-123 for next Friday at 2pm for 4 people",
      expected: "Should parse date, time, party size and product ID"
    },
    {
      message: "Reserve a bike rental for 3 hours starting at 10am",
      expected: "Should identify rental booking with duration"
    },
    {
      message: "Check availability for whale watching tours this weekend",
      expected: "Should check availability for tours"
    }
  ];

  for (const test of testMessages) {
    console.log(`\nTest: "${test.message}"`);
    console.log(`Expected: ${test.expected}`);
    
    try {
      // Process message through Mastra
      const result = await mastra.run({
        agentId: 'booking-assistant',
        messages: [
          {
            role: 'user',
            content: test.message
          }
        ]
      });
      
      console.log('Result:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Error:', error);
    }
  }
}

// Helper to test the booking parsing function
import { parseBookingRequirements, detectBookingIntent } from '../src/mastra/agents/bookingAgent';

function testBookingParsing() {
  console.log('\n\nTesting Booking Parsing Functions...\n');
  
  const testMessages = [
    "Book a tour for 4 people on 3/15/2024 at 2:30pm",
    "I need to reserve 2 tickets for tomorrow",
    "Can you book the sunset kayak tour for next Monday?",
    "Reserve a bike for 3 hours starting at 10am",
    "Check if there's availability for whale watching this Saturday"
  ];
  
  for (const message of testMessages) {
    console.log(`\nMessage: "${message}"`);
    console.log(`Has booking intent: ${detectBookingIntent(message)}`);
    
    const parsed = parseBookingRequirements(message);
    console.log('Parsed fields:', parsed.collectedFields);
  }
}

// Run tests
if (require.main === module) {
  console.log('=== Booking Agent Test Suite ===\n');
  
  // Test parsing functions
  testBookingParsing();
  
  // Test agent if MCP server is available
  if (process.env.MCP_SERVER_URL) {
    testBookingAgent().catch(console.error);
  } else {
    console.log('\n\nSkipping agent tests - MCP_SERVER_URL not configured');
    console.log('To test the full agent, set MCP_SERVER_URL environment variable');
  }
}