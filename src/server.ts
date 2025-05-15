import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// Import new service modules
import { createGoGuideClient } from './services/goguide-api';
import { withRetry } from './utils/retry';

dotenv.config();

// Define the type for message roles
type MessageRole = 'user' | 'assistant';

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase client
const SUPABASE_URL = "https://dhelbmzzhobadauctczs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

let mcpClient: Client | null = null;

async function ensureMcpConnection() {
  if (!mcpClient) {
    mcpClient = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    const transport = new SSEClientTransport(
      new URL("https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com/sse")
    );
    await mcpClient.connect(transport);
  }
  return mcpClient;
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Initial message endpoint
app.post('/analyze-message', async (req, res) => {
  console.log('Processing message');
  try {
    const { messageId, profileId, requestText } = req.body;

    if (!messageId || !profileId || !requestText) {
      return res.status(400).json({
        error: 'Missing required fields: messageId, profileId, or requestText'
      });
    }

    // Get the phone number from the original message
    const { data: message, error: messageError } = await supabase
      .from('incoming_twilio_messages')
      .select('from_number')
      .eq('id', messageId)
      .single();

    if (messageError) throw messageError;
    const phoneNumber = message.from_number;

    // Create a new conversation message
    const { data: newMessage, error: messageInsertError } = await supabase
      .from('conversation_messages')
      .insert({
        profile_id: profileId,
        phone_number: phoneNumber,
        direction: 'incoming',
        content: requestText,
        status: 'pending'
      })
      .select()
      .single();

    if (messageInsertError) throw messageInsertError;

    // Send acknowledgment to user
    await supabase.functions.invoke('send-sms', {
      body: {
        to: phoneNumber,
        message: "I'm processing your request. I'll get back to you shortly."
      }
    });

    res.json({
      success: true,
      message: "Request accepted and being processed",
      messageId: newMessage.id
    });

  } catch (error) {
    console.error('Error creating conversation message:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Process message endpoint (called by database trigger)
app.post('/process-message', async (req, res) => {
  try {
    const { message_id, profile_id, phone_number, content, direction, parent_message_id } = req.body;
    
    if (!message_id || !profile_id || !phone_number || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create a new message with pending status for the worker to process
    const { error: insertError } = await supabase
      .from('conversation_messages')
      .insert({
        id: message_id,  // Use the same ID that was sent
        profile_id,
        phone_number,
        direction,
        content,
        parent_message_id,
        status: 'pending'  // This is what the worker looks for
      });

    if (insertError) {
      console.error('Error creating pending message:', insertError);
      return res.status(500).json({ error: 'Failed to create pending message' });
    }

    // Quickly acknowledge the request
    res.json({ 
      success: true, 
      message: 'Message queued for processing',
      message_id 
    });
    
  } catch (error) {
    console.error('Error creating pending message:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 