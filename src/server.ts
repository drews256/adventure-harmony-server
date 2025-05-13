import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages/messages';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase client
const SUPABASE_URL = "https://dhelbmzzhobadauctczs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoZWxibXp6aG9iYWRhdWN0Y3pzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIyNjE4NjAsImV4cCI6MjA1NzgzNzg2MH0.YsAuD4nlB2dF5vNGs7itgRO21yRYx6Ge8MYeCIXDMzo";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
var tools: Tool[] = [];

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Message analysis endpoint
app.post('/analyze-message', async (req, res) => {
  try {
    const { messageId, profileId, requestText } = req.body;

    console.log(messageId, profileId, requestText);

    if (!messageId || !profileId || !requestText) {
      return res.status(400).json({
        error: 'Missing required fields: messageId, profileId, or requestText'
      });
    }

    try {
      const transport = new SSEClientTransport(new URL("https://3148-63-169-127-154.ngrok-free.app/sse"));
      await mcp.connect(transport);
  
      const toolsResult = await mcp.listTools();
      tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      console.log(
        "Connected to server with tools:",
        tools.map(({ name }) => name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }

    // Create analysis record
    const { data: analysis, error: analysisError } = await supabase
      .from('message_analysis')
      .insert({
        message_id: messageId,
        profile_id: profileId,
        request_text: requestText,
        status: 'pending',
        analysis_started_at: new Date().toISOString()
      })
      .select()
      .single();

    console.log(analysis);

    if (analysisError) throw analysisError;

    // Get the phone number from the original message
    const { data: message, error: messageError } = await supabase
      .from('incoming_twilio_messages')
      .select('from_number')
      .eq('id', messageId)
      .single();

    console.log(message);
    if (messageError) throw messageError;
    const phoneNumber = message.from_number;

    // Fetch conversation events
    const { data: events, error: eventsError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('profile_id', profileId)
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true })
      .limit(10);

    console.log(events)
    if (eventsError) throw eventsError;

    // Fetch previous conversation history
    const { data: history, error: historyError } = await supabase
      .from('claude_conversation_history')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('profile_id', profileId)
      .order('created_at', { ascending: true });

    console.log(history)
    if (historyError) throw historyError;

    // Build message history
    const anthropicMessages: MessageParam[] = history?.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content
    })) || [];

    // Add the current request
    const userContent = `Here's the context:
      Upcoming Events: ${JSON.stringify(events)}
      Current Request: ${requestText}
      
      Please analyze this information and provide a response. Remember to:
      1. Use America/Los_Angeles timezone for all times
      2. Format dates in a user-friendly way
      3. Be clear about event durations
      4. Include timezone information when relevant
      5. Group events by date when listing multiple events`;

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 1000,
      tools: tools,
      messages: [
        ...anthropicMessages,
        {
          role: 'user',
          content: userContent
        }
      ],
    });

    // Extract text content from response, filtering out any tool use blocks
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('\n');

    // Save the user message to conversation history
    await supabase.from('claude_conversation_history').insert({
      profile_id: profileId,
      phone_number: phoneNumber,
      role: 'user',
      content: userContent,
      message_id: messageId
    });

    // Save Claude's response to conversation history
    await supabase.from('claude_conversation_history').insert({
      profile_id: profileId,
      phone_number: phoneNumber,
      role: 'assistant',
      content: responseText,
      message_id: messageId
    });

    // Update analysis record with response
    await supabase
      .from('message_analysis')
      .update({
        response_text: responseText,
        status: 'completed',
        analysis_completed_at: new Date().toISOString()
      })
      .eq('id', analysis.id);

    // Send response back via SMS
    await supabase.functions.invoke('send-sms', {
      body: {
        to: phoneNumber,
        message: responseText
      }
    });

    res.json({
      success: true,
      response: responseText
    });

  } catch (error) {
    console.trace();
    console.error('Error in analyze-message endpoint:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 