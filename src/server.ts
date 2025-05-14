import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

dotenv.config();

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
    const { message_id, profile_id, phone_number, content, direction, parent_message_id, tool_results } = req.body;

    // Update status to processing
    await supabase
      .from('conversation_messages')
      .update({ status: 'processing' })
      .eq('id', message_id);

    // Get conversation history
    const { data: history } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('phone_number', phone_number)
      .eq('profile_id', profile_id)
      .order('created_at', { ascending: true })
      .limit(10);

    // Connect to MCP if needed
    const mcp = await ensureMcpConnection();
    const toolsResult = await mcp.listTools();
    const tools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    // Build conversation for Claude
    const messages = history?.map(msg => ({
      role: msg.direction === 'incoming' ? 'user' : 'assistant' as const,
      content: msg.content
    })) || [];

    // Call Claude
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      tools,
      messages: [...messages, { role: 'user', content }]
    });

    let finalResponse = '';
    let toolCalls = [];

    // Process Claude's response
    for (const block of response.content) {
      if (block.type === 'text') {
        finalResponse += block.text + '\n';
      } else if (block.type === 'tool_use') {
        toolCalls.push(block);
        
        try {
          // Execute tool call
          const toolResult = await mcp.callTool({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
            tool_result: []
          });

          // Create a new message for the tool result
          await supabase
            .from('conversation_messages')
            .insert({
              profile_id,
              phone_number,
              direction: 'outgoing',
              content: JSON.stringify(toolResult),
              parent_message_id: message_id,
              tool_calls: [block],
              status: 'pending'
            });

          // Send immediate tool result via SMS if it's a text response
          if (typeof toolResult === 'object' && toolResult !== null && 'text' in toolResult) {
            await supabase.functions.invoke('send-sms', {
              body: {
                to: phone_number,
                message: `Tool result: ${toolResult.text}`
              }
            });
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          finalResponse += `Sorry, I encountered an error while trying to use one of my tools. ${errorMessage}\n`;
        }
      }
    }

    // Create response message
    await supabase
      .from('conversation_messages')
      .insert({
        profile_id,
        phone_number,
        direction: 'outgoing',
        content: finalResponse,
        parent_message_id: message_id,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        status: 'completed'
      });

    // Update original message as completed
    await supabase
      .from('conversation_messages')
      .update({ status: 'completed' })
      .eq('id', message_id);

    // Send response via SMS
    if (finalResponse) {
      await supabase.functions.invoke('send-sms', {
        body: {
          to: phone_number,
          message: finalResponse
        }
      });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Error processing message:', error);
    
    // Update message status to failed
    if (req.body?.message_id) {
      await supabase
        .from('conversation_messages')
        .update({ 
          status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', req.body.message_id);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 