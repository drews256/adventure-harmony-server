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

async function processMessage(messageId: string) {
  try {
    // Get the message to process
    const { data: message, error: messageError } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (messageError) throw messageError;

    // Update status to processing
    await supabase
      .from('conversation_messages')
      .update({ status: 'processing' })
      .eq('id', messageId);

    // Get conversation history
    const { data: history } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('phone_number', message.phone_number)
      .eq('profile_id', message.profile_id)
      .order('created_at', { ascending: true })
      .limit(10);

    // Connect to MCP
    const mcp = await ensureMcpConnection();
    const toolsResult = await mcp.listTools();
    const tools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    // Build conversation for Claude
    const messages = history?.map(msg => {
      const role: 'user' | 'assistant' = msg.direction === 'incoming' ? 'user' : 'assistant';
      return {
        role,
        content: msg.content
      };
    }) || [];

    // Call Claude
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      tools,
      messages: [...messages, { role: 'user' as const, content: message.content }]
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
              profile_id: message.profile_id,
              phone_number: message.phone_number,
              direction: 'outgoing',
              content: JSON.stringify(toolResult),
              parent_message_id: messageId,
              tool_calls: [block],
              status: 'completed'
            });

          // Send immediate tool result via SMS if it's a text response
          if (typeof toolResult === 'object' && toolResult !== null && 'text' in toolResult) {
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
          finalResponse += `Sorry, I encountered an error while trying to use one of my tools. ${errorMessage}\n`;
        }
      }
    }

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

    // Send response via SMS
    if (finalResponse) {
      await supabase.functions.invoke('send-sms', {
        body: {
          to: message.phone_number,
          message: finalResponse
        }
      });
    }

  } catch (error) {
    console.error('Error processing message:', error);
    
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
        console.error('Error fetching pending messages:', error);
        continue;
      }

      if (pendingMessages && pendingMessages.length > 0) {
        const message = pendingMessages[0];
        await processMessage(message.id);
      }

      // Small delay to prevent hammering the database
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Error in worker loop:', error);
      // Add delay on error to prevent rapid retries
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start the worker
console.log('Starting message processing worker...');
workerLoop().catch(error => {
  console.error('Fatal error in worker:', error);
  process.exit(1);
}); 