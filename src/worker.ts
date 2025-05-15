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

// Validate and fix conversation history to ensure tool_use blocks are followed by tool_result blocks
function validateAndFixConversationHistory(messages: any[]): any[] {
  console.log('Validating conversation history for proper tool use/result pairing');
  
  // Verify that tool_use and tool_result blocks are properly paired
  const toolUsesWithoutResults: string[] = [];
  
  for (let i = 0; i < messages.length - 1; i++) {
    const currentMsg = messages[i];
    const nextMsg = messages[i + 1];
    
    // Check if current message has tool_use blocks
    if (Array.isArray(currentMsg.content) && 
        currentMsg.role === 'assistant' && 
        currentMsg.content.some((block: any) => block.type === 'tool_use')) {
      
      // Find the tool_use blocks
      const toolUseBlocks = currentMsg.content.filter((block: any) => block.type === 'tool_use');
      
      // Check if the next message is a user message with tool_result blocks for each tool_use
      if (nextMsg.role !== 'user' || !Array.isArray(nextMsg.content)) {
        toolUsesWithoutResults.push(...toolUseBlocks.map((block: any) => block.id));
        continue;
      }
      
      // Check each tool_use has a matching tool_result
      for (const toolUseBlock of toolUseBlocks) {
        const hasMatchingResult = Array.isArray(nextMsg.content) && 
                                nextMsg.content.some((block: any) => 
                                  block.type === 'tool_result' && 
                                  block.tool_use_id === toolUseBlock.id);
        
        if (!hasMatchingResult) {
          toolUsesWithoutResults.push(toolUseBlock.id);
        }
      }
    }
  }
  
  // If no issues found, return original messages
  if (toolUsesWithoutResults.length === 0) {
    console.log('Conversation history validation successful - all tool_use blocks have matching tool_result blocks');
    return messages;
  }
  
  // Log any tool_use blocks without tool_result blocks
  console.log('WARNING: Found tool_use blocks without matching tool_result blocks:', {
    toolUseIds: toolUsesWithoutResults,
    messageCount: messages.length
  });
  
  // Try to fix the conversation by ensuring every tool_use has a matching tool_result
  console.log('Attempting to fix conversation by adding missing tool_results');
  
  // Create a fixed version of the conversation
  const fixedConversation: any[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const currentMsg = messages[i];
    fixedConversation.push(currentMsg);
    
    // If this is an assistant message with tool_use blocks
    if (currentMsg.role === 'assistant' && Array.isArray(currentMsg.content)) {
      const toolUseBlocks = currentMsg.content.filter((block: any) => block.type === 'tool_use');
      
      if (toolUseBlocks.length > 0) {
        // Check if the next message (if exists) is a user message with tool_result blocks
        const nextIsToolResult = i < messages.length - 1 && 
                                messages[i + 1].role === 'user' && 
                                Array.isArray(messages[i + 1].content) &&
                                messages[i + 1].content.some((block: any) => block.type === 'tool_result');
        
        // If next message is not a tool_result, insert one
        if (!nextIsToolResult) {
          const toolResultsContent = toolUseBlocks.map((toolUse: any) => ({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ status: 'success', result: 'Tool completed successfully' })
          }));
          
          fixedConversation.push({
            role: 'user' as const,
            content: toolResultsContent
          });
          
          console.log('Added synthetic tool_result for missing tool_use responses', {
            toolUseIds: toolUseBlocks.map((block: any) => block.id)
          });
        }
      }
    }
  }
  
  // Return the fixed conversation
  console.log(`Fixed conversation history has ${fixedConversation.length} messages (was ${messages.length})`);
  return fixedConversation;
}

// Removes tool details from conversation history to reduce context size
function cleanConversationHistory(messages: any[]): any[] {
  return messages.map(message => {
    // For string content, just keep as is
    if (typeof message.content === 'string') {
      return message;
    }
    
    // For array content (typically containing tool_use and tool_result blocks)
    if (Array.isArray(message.content)) {
      // Clean up the content array
      const cleanedContent = message.content.map((block: any) => {
        // Keep text blocks unchanged
        if (block.type === 'text') {
          return block;
        }
        
        // For tool use blocks, keep essential fields AND input (which is required)
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input || block.arguments || {}, // Ensure input is always present (required by API)
          };
        }
        
        // For tool result blocks, preserve the complete content
        if (block.type === 'tool_result') {
          console.log('Tool result (preserving full content):', block);
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: block.content // Preserving full content without modification
          };
        }
        
        // Default - return block unchanged
        return block;
      });
      
      return {
        ...message,
        content: cleanedContent
      };
    }
    
    // Default case - return message unchanged
    return message;
  });
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

// Helper function to complete a job with a final response
async function completeJobWithResponse(job: ConversationJob, finalResponse: string) {
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
      tool_calls: null
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
      tool_calls: null,
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
}

async function processJob(job: ConversationJob) {
  try {
    // Connect to MCP server if needed
    const mcp = await ensureMcpConnection();
    
    // Create GoGuide client
    const goGuideClient = createGoGuideClient(mcp, supabase);
    
    // Update job status to processing
    await updateJobStatus(job.id, 'processing');
    
    // Get ALL conversation history for this phone number, not just the most recent
    const { data: allMessages, error: historyError } = await supabase
      .from('claude_conversation_history')
      .select('*')
      .eq('phone_number', job.phone_number)
      .order('created_at', { ascending: false })
      .limit(100);  // Significantly increased limit to include messages outside the current chain
    
    if (historyError) {
      console.error('Error fetching conversation history:', historyError);
    }
    
    // Filter and format the messages
    let additionalHistory: any[] = [];
    if (allMessages && allMessages.length > 0) {
      // Group messages by message_id to avoid duplicates from the same exchange
      const messageGroups = new Map<string, any[]>();
      allMessages.forEach(msg => {
        if (!messageGroups.has(msg.message_id)) {
          messageGroups.set(msg.message_id, []);
        }
        messageGroups.get(msg.message_id)!.push(msg);
      });
      
      // Include ALL message exchanges, not just recent ones
      const allExchanges = Array.from(messageGroups.values())
        .sort((a, b) => new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime());
      
      // For Claude's context, we'll use up to 15 most recent exchanges to avoid token limits
      const claudeContextExchanges = allExchanges.slice(0, 15);
      
      // Flatten and convert to Claude format
      additionalHistory = claudeContextExchanges.flat()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }));
      
      // Log the full conversation history for user awareness
      const allMessagesCount = allExchanges.length;
      const usedMessagesCount = claudeContextExchanges.length;
      console.log(`Retrieved ${additionalHistory.length} messages from ${usedMessagesCount}/${allMessagesCount} total exchanges (including messages outside the current chain)`);
    }
    
    // Get conversation context and relevant tools
    // Include both the job's conversation history and the additional history
    const combinedHistory = [...additionalHistory, ...job.conversation_history];
    
    // Log the combined history to verify we're including messages outside the chain
    console.log(`Combined history contains ${combinedHistory.length} total messages`);
    console.log(`Job conversation history: ${job.conversation_history.length} messages`);
    console.log(`Additional history: ${additionalHistory.length} messages`);
    
    // Log a sample of messages to verify content
    if (additionalHistory.length > 0) {
      console.log('Sample of additional history messages:');
      const sampleSize = Math.min(3, additionalHistory.length);
      for (let i = 0; i < sampleSize; i++) {
        const msg = additionalHistory[i];
        console.log(`[${i}] Role: ${msg.role}, Content: ${typeof msg.content === 'string' ? 
          (msg.content.substring(0, 50) + '...') : 
          'Complex content (array)'}`);
      }
    }
    
    const context = determineConversationContext(combinedHistory);
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
    
    // Clean conversation history to reduce token usage
    // Note: We always use conversation history from database messages, not stored history
    // Validate and fix the conversation history
    const validatedHistory = validateAndFixConversationHistory(combinedHistory);
    
    // Clean conversation history to reduce token usage
    const cleanedHistory = cleanConversationHistory(validatedHistory);
    
    // Prepare messages for Claude API call
    const messageArray = [
      ...cleanedHistory,
      {
        role: 'user' as const,
        content: 
          `You're an assistant for GoGuide.io, a travel service that helps users plan and book outdoor adventure experiences.
          You're communicating with the user via text message, so keep your responses concise and mobile-friendly.
          
          Important notes:
          1. Users are texting you from their phones, so format your responses appropriately for SMS.
          2. You have access to tools that can help answer questions, but users aren't explicitly granting permission for tool use.
          3. Do not mention tool usage in your responses - just provide helpful answers based on the tool results.
          4. GoGuide.io (https://www.GoGuide.io) specializes in outdoor adventures and travel experiences.
          5. Be sure to reference ALL previous messages in the conversation history, even ones that may seem to be from a separate conversation chain.
          6. Users expect you to have access to their entire message history, so don't act confused about messages from previous interactions.
          
          Using the COMPLETE conversation context and the user's request, please help them in a friendly, conversational manner.
          Here is the user's message: ${job.request_text}`
      }
    ];
    
    // Estimate token usage
    const estimatedTokens = estimateTokenCount(messageArray, tools);
    console.log(`Estimated token count for Claude API call: ${estimatedTokens}`);
    
    // Log warning if token count is high
    if (estimatedTokens > 30000) {
      console.log(`WARNING: High token count (${estimatedTokens}) may exceed limits`);
    }
    
    console.log('Calling Claude with cleaned conversation history');
    
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

    // Check if the response contains a stop_reason and log it
    const hasStopReason = (response as any).stop_reason !== undefined;
    if (hasStopReason) {
      console.log(`Response contains stop_reason: ${(response as any).stop_reason}`);
    }
    
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
          
          // Log the message context when running the tool
          console.log('Current message context before tool execution:', {
            messagesCount: job.conversation_history.length,
            latestMessages: job.conversation_history.slice(-2).map((m: any) => ({
              role: m.role,
              contentType: typeof m.content === 'string' ? 'text' : 'array',
              contentPreview: typeof m.content === 'string' 
                ? m.content.substring(0, 100) + '...' 
                : JSON.stringify(m.content).substring(0, 100) + '...'
            })),
            toolName: block.name,
            toolId: block.id,
            toolInput: block.input
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
          
          // Log detailed information about tool results
          console.log('Tool execution completed with results:', { 
            toolName: block.name,
            toolId: block.id,
            rawResult: JSON.stringify(toolResult).substring(0, 200) + '...',
            formattedResult: formattedResult.text ? formattedResult.text.substring(0, 200) + '...' : 'No formatted text'
          });
          
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
          // For the tool result, create a more detailed representation that's easier to parse
          const formattedToolResultContent = {
            type: "tool_result",
            tool_name: block.name,
            tool_input: block.input,
            result: toolResult,
            formatted_result: formattedResult.text
          };
          
          // We need to structure the conversation history properly for tool use/result
          // When a tool_use appears in an assistant message, the next user message must contain
          // a tool_result block with the matching ID
          
          // First, check if the request is already in conversation history to avoid duplication
          const requestAlreadyPresent = job.conversation_history.some(
            msg => msg.role === 'user' && msg.content === job.request_text
          );
          
          // Begin building the updated history by including ALL raw messages in the proper order
          let updatedConversationHistory = [...job.conversation_history];
          
          // Log the existing conversation history for debugging
          console.log(`Current job history has ${updatedConversationHistory.length} messages before adding new tool interaction`);
          
          // Add user request if not already present
          if (!requestAlreadyPresent) {
            updatedConversationHistory.push({
              role: 'user' as const,
              content: job.request_text
            });
          }
          
          // Add assistant response with tool_use block
          updatedConversationHistory.push({
            role: 'assistant' as const,
            content: [
              { type: 'text', text: finalResponse || '' },
              { 
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input || block.arguments || {} // Ensure input is always present
              }
            ]
          });
          
          // Add user message with tool_result - this must be in proper Claude format
          updatedConversationHistory.push({
            role: 'user' as const,
            content: [
              {
                type: 'tool_result',
                tool_use_id: block.id,
                content: typeof toolResult === 'string' 
                  ? toolResult 
                  : JSON.stringify(toolResult)
              }
            ]
          });
          
          // After tool execution, update to 'tool_complete' with the result
          await updateJobStatus(job.id, 'tool_complete', {
            tool_results: job.tool_results.concat({
              ...toolCall,
              tool_result: toolResult
            } as unknown as Record<string, unknown>),
            conversation_history: updatedConversationHistory
          });
          
          // Prepare messages for follow-up Claude API call - validate and clean to reduce token usage
          const validatedToolResponseHistory = validateAndFixConversationHistory(updatedConversationHistory);
          const toolResponseMessages = cleanConversationHistory(validatedToolResponseHistory);
          
          // Check if we should make a follow-up call based on stop_reason
          if (hasStopReason) {
            console.log(`Skipping follow-up Claude call due to stop_reason: ${(response as any).stop_reason}`);
            
            // Add formatted tool result directly to the final response
            const formattedResponse = `Here's what I found: ${formattedResult.text || 'No specific data found.'}`;
            finalResponse += formattedResponse + '\n';
            
            // Continue to next tool or complete processing without follow-up call
          } else {
            // Estimate token usage for follow-up call
            const toolResponseTokens = estimateTokenCount(toolResponseMessages, tools);
            console.log(`Estimated token count for tool response API call: ${toolResponseTokens}`);
            
            // Log warning if token count is high
            if (toolResponseTokens > 30000) {
              console.log(`WARNING: High token count (${toolResponseTokens}) in tool response call may exceed limits`);
            }
            
            // For the follow-up call, only include the specific tool that was just used
            // This drastically reduces context size
            const specificTool = tools.find(tool => tool.name === block.name);
            const toolsToUse = specificTool ? [specificTool] : tools;
            
            console.log(`Using ${toolsToUse.length === 1 ? 'single specific tool' : 'all tools'} for follow-up call`);

            console.log('Sending tool response messages to Claude');
            console.log(toolResponseMessages);
            
            // Continue conversation with tool result
            const toolResponse = await withRetry(
              () => anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                tools: toolsToUse,
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
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          
          // Enhanced error logging
          console.log('Tool execution failed:', { 
            error: errorMessage,
            toolName: block.name,
            toolId: block.id,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
          });
          
          // Add more detailed information about tool format to help with debugging
          console.log('Tool call format that caused error:', {
            toolBlock: JSON.stringify(block, null, 2),
            hasInput: !!block.input,
            hasArguments: !!block.arguments,
            inputType: block.input ? typeof block.input : 'undefined',
            argumentsType: block.arguments ? typeof block.arguments : 'undefined'
          });
          
          // Add error message to response
          finalResponse += `I encountered an error while trying to retrieve information: ${errorMessage}\n`;
          
          // Update job with error
          await updateJobStatus(job.id, 'processing', {
            tool_results: job.tool_results.concat(toolCall as unknown as Record<string, unknown>)
          });
        }
      }
    }

    // Save conversation history with tool calls if any
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

      // 30-second delay between job processing attempts
      await new Promise(resolve => setTimeout(resolve, 30000));
    } catch (error) {
      console.error('Worker error:', error);
      // 30-second delay on error before retrying
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}