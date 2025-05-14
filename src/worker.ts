import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ConversationJob, ConversationJobStatus, ToolCallState } from './types';
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

async function updateJobStatus(
  jobId: string, 
  status: ConversationJobStatus, 
  updates: Partial<ConversationJob> = {}
) {
  const { error } = await supabase
    .from('conversation_jobs')
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...updates
    })
    .eq('id', jobId);

  if (error) throw error;
}

async function processJob(job: ConversationJob) {
  try {
    // Connect to MCP server if needed
    const mcp = await ensureMcpConnection();

    // Update job status to processing
    await updateJobStatus(job.id, 'processing');

    // Get tools list
    const toolsResult = await mcp.listTools();
    const tools = toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    // Call Claude with current conversation state
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      tools,
      messages: [
        ...job.conversation_history,
        {
          role: 'user',
          content: job.request_text
        }
      ],
    });

    let finalResponse = '';
    let toolCalls: ToolCallState[] = [];

    // Process each content block
    for (const block of response.content) {
      if (block.type === 'text') {
        finalResponse += block.text + '\n';
      } else if (block.type === 'tool_use') {
        console.log('Tool use', block);
        // Create tool call state
        const toolCall: ToolCallState = {
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
          tool_result: [],
        };
        toolCalls.push(toolCall);

        try {
          // Update job status to waiting for tool
          await updateJobStatus(job.id, 'waiting_for_tool', {
            current_step: job.current_step + 1,
            tool_results: job.tool_results.concat(toolCall as unknown as Record<string, unknown>)
          });

          // Execute tool call
          const toolResult = await mcp.callTool({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
            tool_result: []
          });

          // Send immediate tool result via SMS if it's a text response
          if (typeof toolResult === 'object' && toolResult !== null && 'text' in toolResult) {
            await supabase.functions.invoke('send-sms', {
              body: {
                to: job.phone_number,
                message: `Tool result: ${toolResult.text}`
              }
            });
          }

          // Update tool call state
          //toolCall.result = toolResult;
          //toolCall.status = 'completed';

          // Update job status
          await updateJobStatus(job.id, 'tool_complete', {
            tool_results: job.tool_results.concat(toolCall as unknown as Record<string, unknown>)
          });

          // Continue conversation with tool result
          const toolResponse = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            tools,
            messages: [
              ...job.conversation_history,
              {
                role: 'user',
                content: job.request_text
              },
              {
                role: 'assistant',
                content: [
                  { type: 'text', text: finalResponse },
                  block
                ]
              },
              {
                role: 'user',
                content: JSON.stringify(toolResult)
              }
            ],
          });

          // Add tool response to final response
          for (const toolBlock of toolResponse.content) {
            if (toolBlock.type === 'text') {
              finalResponse += toolBlock.text + '\n';
            }
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          
          // Update tool call state
          //toolCall.status = 'failed';
          //toolCall.error_message = errorMessage;

          // Add error message to response
          finalResponse += `Sorry, I encountered an error while trying to use one of my tools. ${errorMessage}\n`;
          
          // Update job with error
          await updateJobStatus(job.id, 'processing', {
            tool_results: job.tool_results.concat(toolCall as unknown as Record<string, unknown>)
          });
        }
      }
    }

    // Save conversation history
    await supabase.from('claude_conversation_history').insert([
      {
        profile_id: job.profile_id,
        phone_number: job.phone_number,
        role: 'user',
        content: job.request_text,
        message_id: job.message_id
      },
      {
        profile_id: job.profile_id,
        phone_number: job.phone_number,
        role: 'assistant',
        content: finalResponse,
        message_id: job.message_id,
        tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null
      }
    ]);

    // Update job as completed
    await updateJobStatus(job.id, 'completed', {
      final_response: finalResponse
    });

    // Send final response via SMS
    await supabase.functions.invoke('send-sms', {
      body: {
        to: job.phone_number,
        message: finalResponse
      }
    });

  } catch (error) {
    console.error('Error processing job:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    
    await updateJobStatus(job.id, 'failed', {
      error_message: errorMessage
    });

    // Notify user of failure
    await supabase.functions.invoke('send-sms', {
      body: {
        to: job.phone_number,
        message: `Sorry, I encountered an error while processing your request. ${errorMessage}`
      }
    });
  }
}

export async function startWorker() {
  console.log('Starting conversation worker...');

  while (true) {
    try {
      // Get next pending job
      const { data: jobs, error } = await supabase
        .from('conversation_jobs')
        .select('*')
        .in('status', ['pending', 'waiting_for_tool'])
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error('Error fetching jobs:', error);
        continue;
      }

      if (jobs && jobs.length > 0) {
        const job = jobs[0] as ConversationJob;
        await processJob(job);
      }

      // Wait before checking for more jobs
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Worker error:', error);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
} 