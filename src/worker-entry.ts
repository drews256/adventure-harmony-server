import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import dotenv from 'dotenv';

dotenv.config();

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

// Add timestamp to logs
function logWithTimestamp(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`${message}`, data);
  } else {
    console.log(`${message}`);
  }
}

async function processMessage(messageId: string) {
  logWithTimestamp(`Starting to process message: ${messageId}`);
  try {
    // Get the message to process
    const { data: message, error: messageError } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (messageError) throw messageError;
    logWithTimestamp('Retrieved message details:', {
      id: message.id,
      direction: message.direction,
      content: message.content.substring(0, 100) + '...' // Log first 100 chars
    });

    // Update status to processing
    await supabase
      .from('conversation_messages')
      .update({ status: 'processing' })
      .eq('id', messageId);
    logWithTimestamp('Updated message status to processing');

    // Get conversation history
    const { data: history } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('phone_number', message.phone_number)
      .eq('profile_id', message.profile_id)
      .order('created_at', { ascending: true })
      .limit(10);

    logWithTimestamp(`Retrieved ${history?.length || 0} conversation history messages`);

    // Connect to MCP
    const mcp = await ensureMcpConnection();
    const toolsResult = await mcp.listTools();
    const tools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    logWithTimestamp(`Connected to MCP and retrieved ${tools.length} available tools`);

    // Build conversation for Claude
    const messages = history?.map(msg => {
      const role: 'user' | 'assistant' = msg.direction === 'incoming' ? 'user' : 'assistant';
      return {
        role,
        content: msg.content
      };
    }) || [];

    logWithTimestamp('Calling Claude with conversation history');
    // Call Claude
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      tools,
      messages: [...messages, { role: 'user' as const, content: message.content }]
    });
    logWithTimestamp('Received response from Claude');

    let finalResponse = '';
    let toolCalls = [];
    logWithTimestamp('Claude response:', response);
    logWithTimestamp('Claude content:', response.content);

    // Process Claude's response
    for (const block of response.content) {
      if (block.type === 'text') {
        finalResponse += block.text + '\n';
        logWithTimestamp('Received text response from Claude:', {
          text: block.text.substring(0, 100) + '...' // Log first 100 chars
        });
      } else if (block.type === 'tool_use') {
        logWithTimestamp('Received tool use from Claude:', {
          tool: block.name,
          arguments: block.input
        });
        toolCalls.push(block);
        logWithTimestamp('Received tool call from Claude:', {
          tool: block.name,
          arguments: block.input
        });
        
        try {
          // Execute tool call
          logWithTimestamp(`Executing tool: ${block.name}`);
          const toolResult = await mcp.callTool({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
            tool_result: []
          });
          logWithTimestamp('Tool execution completed:', { result: toolResult });

          // Create a new message for the tool result
          await supabase
            .from('conversation_messages')
            .insert({
              profile_id: message.profile_id,
              phone_number: message.phone_number,
              direction: 'outgoing',
              content: JSON.stringify(toolResult),
              parent_message_id: messageId,
              tool_calls: [block],
              status: 'completed'
            });
          logWithTimestamp('Saved tool result to database');

          // Send immediate tool result via SMS if it's a text response
          if (typeof toolResult === 'object' && toolResult !== null && 'text' in toolResult) {
            logWithTimestamp('Sending tool result via SMS');
            await supabase.functions.invoke('send-sms', {
              body: {
                to: message.phone_number,
                message: `Tool result: ${toolResult.text}`
              }
            });
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          logWithTimestamp('Tool execution failed:', { error: errorMessage });
          finalResponse += `Sorry, I encountered an error while trying to use one of my tools. ${errorMessage}\n`;
        }
      }
    }

    logWithTimestamp('Creating final response message');
    // Create response message
    await supabase
      .from('conversation_messages')
      .insert({
        profile_id: message.profile_id,
        phone_number: message.phone_number,
        direction: 'outgoing',
        content: finalResponse,
        parent_message_id: messageId,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        status: 'completed'
      });

    // Update original message as completed
    await supabase
      .from('conversation_messages')
      .update({ status: 'completed' })
      .eq('id', messageId);
    logWithTimestamp('Updated original message status to completed');

    // Send response via SMS
    if (finalResponse) {
      logWithTimestamp('Sending final response via SMS');
      await supabase.functions.invoke('send-sms', {
        body: {
          to: message.phone_number,
          message: finalResponse
        }
      });
    }

    logWithTimestamp(`Successfully completed processing message: ${messageId}`);

  } catch (error) {
    console.error('Error processing message:', error);
    logWithTimestamp(`Error processing message ${messageId}:`, { error });
    
    // Update message status to failed
    await supabase
      .from('conversation_messages')
      .update({ 
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', messageId);
  }
}

// Main worker loop
async function workerLoop() {
  logWithTimestamp('Worker loop started');
  while (true) {
    try {
      // Get pending messages
      const { data: pendingMessages, error } = await supabase
        .from('conversation_messages')
        .select('id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        logWithTimestamp('Error fetching pending messages:', { error });
        continue;
      }

      if (pendingMessages && pendingMessages.length > 0) {
        const message = pendingMessages[0];
        logWithTimestamp(`Found pending message: ${message.id}`);
        await processMessage(message.id);
      } else {
        logWithTimestamp('No pending messages found, waiting...');
      }

      // Small delay to prevent hammering the database
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logWithTimestamp('Error in worker loop:', { error });
      // Add delay on error to prevent rapid retries
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start the worker
logWithTimestamp('Starting message processing worker...');
workerLoop().catch(error => {
  logWithTimestamp('Fatal error in worker:', { error });
  process.exit(1);
}); 