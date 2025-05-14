import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ConversationJob, ConversationJobStatus, ToolCallState } from './types';
import dotenv from 'dotenv';

// Import new service modules
import { GoGuideAPIClient, createGoGuideClient } from './services/goguide-api';
import { determineConversationContext, getRelevantTools } from './services/tool-context';
import { cachedToolCall } from './services/cache';
import { formatToolResponse } from './services/response-formatter';
import { executeToolPipeline, commonPipelines } from './services/tool-pipeline';
import { suggestToolsForMessage, addToolSuggestionsToPrompt } from './services/tool-discovery';
import { withRetry } from './utils/retry';

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

// Estimate token count for API calls
function estimateTokenCount(messages: any[], tools: any[]): number {
  // Simple approximation: 4 chars ≈ 1 token for English text
  const messageText = messages
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    .join(' ');
  
  const toolText = JSON.stringify(tools);
  
  // Calculate and return token estimate
  return Math.ceil((messageText.length + toolText.length) / 4);
}

async function processJob(job: ConversationJob) {
  try {
    // Connect to MCP server if needed
    const mcp = await ensureMcpConnection();
    
    // Create GoGuide client
    const goGuideClient = createGoGuideClient(mcp, supabase);
    
    // Update job status to processing
    await updateJobStatus(job.id, 'processing');
    
    // Get conversation context and relevant tools
    const context = determineConversationContext(job.conversation_history);
    const relevantTools = await getRelevantTools(job, goGuideClient);
    
    // Add specific tool suggestions based on message content
    const suggestedTools = suggestToolsForMessage(job.request_text, await goGuideClient.getTools());
    
    // Use a Map to deduplicate tools by name
    const toolMap = new Map();
    
    // Add all tools to the map using name as key to ensure uniqueness
    [...relevantTools, ...suggestedTools].forEach(tool => {
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
      }
    });
    
    // Convert back to array
    const uniqueTools = Array.from(toolMap.values());
    
    console.log(`Processing job in ${context} context with ${uniqueTools.length} relevant unique tools`);
    
    // Convert tools to format expected by Claude
    const tools = uniqueTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    
    // Prepare messages for Claude API call
    const messageArray = [
      ...job.conversation_history,
      {
        role: 'user' as const,
        content: job.request_text
      }
    ];
    
    // Estimate token usage
    const estimatedTokens = estimateTokenCount(messageArray, tools);
    console.log(`Estimated token count for Claude API call: ${estimatedTokens}`);
    
    // Log warning if token count is high
    if (estimatedTokens > 30000) {
      console.log(`WARNING: High token count (${estimatedTokens}) may exceed limits`);
    }
    
    // Call Claude with current conversation state
    const response = await withRetry(
      () => anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        tools,
        messages: messageArray,
      }),
      {
        maxRetries: 2,
        retryableErrors: ['rate limit', 'timeout', 'network error']
      }
    );

    let finalResponse = '';
    let toolCalls: ToolCallState[] = [];

    // Process each content block - type assertion needed since API types are complex
    const responseContent = (response as any).content;
    for (const block of responseContent) {
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
          // Update job status
          await updateJobStatus(job.id, 'waiting_for_tool', {
            current_step: job.current_step + 1,
            tool_results: job.tool_results.concat(toolCall as unknown as Record<string, unknown>)
          });
          
          // Execute tool call with caching
          const toolResult = await cachedToolCall(
            block.name,
            block.input as Record<string, unknown>,
            () => mcp.callTool({
              id: block.id,
              name: block.name,
              arguments: block.input as Record<string, unknown>,
              tool_result: []
            })
          );
          
          // Format response for better user experience
          const formattedResult = formatToolResponse(block.name, toolResult);
          
          // Send immediate tool result via SMS if appropriate
          if (formattedResult.text) {
            await supabase.functions.invoke('send-sms', {
              body: {
                to: job.phone_number,
                message: formattedResult.text
              }
            });
          }
          
          // Format the tool result for better readability
          const formattedToolResult = formatToolResponse(block.name, toolResult);
          
          // Create updated conversation history including this tool interaction
          const updatedConversationHistory = [
            ...job.conversation_history,
            {
              role: 'user' as const,
              content: job.request_text
            },
            {
              role: 'assistant' as const,
              content: [
                { type: 'text', text: finalResponse },
                block
              ]
            },
            {
              role: 'user' as const,
              content: JSON.stringify(toolResult)
            }
          ];
          
          // After tool execution, update to 'tool_complete' with the result
          await updateJobStatus(job.id, 'tool_complete', {
            tool_results: job.tool_results.concat({
              ...toolCall,
              tool_result: toolResult
            } as unknown as Record<string, unknown>),
            conversation_history: updatedConversationHistory
          });
          
          // Prepare messages for follow-up Claude API call
          const toolResponseMessages = updatedConversationHistory;
          
          // Estimate token usage for follow-up call
          const toolResponseTokens = estimateTokenCount(toolResponseMessages, tools);
          console.log(`Estimated token count for tool response API call: ${toolResponseTokens}`);
          
          // Log warning if token count is high
          if (toolResponseTokens > 30000) {
            console.log(`WARNING: High token count (${toolResponseTokens}) in tool response call may exceed limits`);
          }
          
          // Continue conversation with tool result
          const toolResponse = await withRetry(
            () => anthropic.messages.create({
              model: "claude-3-5-sonnet-20241022",
              max_tokens: 1000,
              tools,
              messages: toolResponseMessages,
            }),
            {
              maxRetries: 2,
              retryableErrors: ['rate limit', 'timeout', 'network error']
            }
          );
          
          // Add tool response to final response
          const toolResponseContent = (toolResponse as any).content;
          let toolResponseText = '';
          
          for (const toolBlock of toolResponseContent) {
            if (toolBlock.type === 'text') {
              toolResponseText += toolBlock.text + '\n';
              finalResponse += toolBlock.text + '\n';
            }
          }
          
          // Update conversation history again with Claude's response to the tool result
          if (toolResponseText.trim()) {
            updatedConversationHistory.push({
              role: 'assistant' as const,
              content: toolResponseText
            });
            
            // Update the job with the newest conversation history
            await updateJobStatus(job.id, 'processing', {
              conversation_history: updatedConversationHistory
            });
            
            // Update the local job object to keep it in sync
            job.conversation_history = updatedConversationHistory;
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          
          // Add error message to response
          finalResponse += `I encountered an error while trying to retrieve information: ${errorMessage}\n`;
          
          // Update job with error
          await updateJobStatus(job.id, 'processing', {
            tool_results: job.tool_results.concat(toolCall as unknown as Record<string, unknown>)
          });
        }
      }
    }

    // Save conversation history to both the history table and the message
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
    
    // Get the original message to maintain parent-child relationship
    const { data: originalMessage } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('id', job.message_id)
      .single();
      
    // Create a new message with the response and conversation history
    await supabase
      .from('conversation_messages')
      .insert({
        profile_id: job.profile_id,
        phone_number: job.phone_number,
        direction: 'outgoing',
        content: finalResponse,
        parent_message_id: job.message_id,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        conversation_history: JSON.stringify(job.conversation_history),
        status: 'completed'
      });

    // Update job as completed
    await updateJobStatus(job.id, 'completed', {
      final_response: finalResponse,
      conversation_history: job.conversation_history
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