import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
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

// Add timestamp to logs
function logWithTimestamp(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.log(`${message}`, data);
  } else {
    console.log(`${message}`);
  }
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

// Filter tools based on message content
function filterToolsByContent(allTools: any[], messageContent: string): any[] {
  if (!messageContent || !allTools || allTools.length === 0) {
    return allTools; // Return all tools if no message content or tools
  }

  // Convert message to lowercase for matching
  const content = messageContent.toLowerCase();
  
  // Define categories of tools with their associated keywords
  const toolCategories: Record<string, string[]> = {
    calendar: ['calendar', 'schedule', 'appointment', 'meeting', 'event', 'reminder', 'date', 'time', 'book', 'reservation'],
    travel: ['travel', 'trip', 'flight', 'hotel', 'car', 'book', 'reservation', 'location', 'directions', 'map'],
    weather: ['weather', 'forecast', 'temperature', 'rain', 'snow', 'sunny', 'cloudy', 'storm', 'climate'],
    search: ['search', 'find', 'lookup', 'information', 'data', 'about', 'what is', 'who is', 'tell me'],
    messaging: ['message', 'send', 'text', 'email', 'contact', 'phone', 'call', 'notify', 'chat'],
    shopping: ['buy', 'purchase', 'order', 'shop', 'price', 'cost', 'store', 'product', 'item', 'cart'],
    food: ['food', 'restaurant', 'meal', 'eat', 'dinner', 'lunch', 'breakfast', 'recipe', 'cook', 'delivery'],
    health: ['health', 'medical', 'doctor', 'symptom', 'medicine', 'appointment', 'fitness', 'exercise', 'workout'],
    media: ['movie', 'music', 'song', 'artist', 'album', 'play', 'watch', 'video', 'stream', 'show', 'listen'],
    financial: ['money', 'payment', 'bank', 'transfer', 'account', 'balance', 'transaction', 'pay', 'bill', 'cost', 'price']
  };
  
  // Check which categories match the message content
  const matchedCategories = Object.entries(toolCategories)
    .filter(([category, keywords]) => 
      keywords.some(keyword => content.includes(keyword))
    )
    .map(([category]) => category);
  
  logWithTimestamp(`Message matches categories: ${matchedCategories.join(', ') || 'none'}`);
  
  // If no categories match, return a basic set of tools
  if (matchedCategories.length === 0) {
    // Return a small subset of essential tools (roughly 20% of all tools)
    const essentialTools = allTools.filter((tool, index) => index % 5 === 0);
    logWithTimestamp(`No specific categories matched. Returning ${essentialTools.length} essential tools`);
    return essentialTools;
  }
  
  // Filter tools based on matched categories
  const relevantTools = allTools.filter(tool => {
    const toolName = tool.name.toLowerCase();
    const toolDesc = tool.description?.toLowerCase() || '';
    
    // Check if tool matches any of the identified categories
    return matchedCategories.some(category => {
      // Check if tool name or description contains the category name
      if (toolName.includes(category) || toolDesc.includes(category)) {
        return true;
      }
      
      // Check if tool matches keywords for this category
      return toolCategories[category].some(keyword => 
        toolName.includes(keyword) || toolDesc.includes(keyword)
      );
    });
  });
  
  // Make sure we don't filter out too many tools
  if (relevantTools.length < allTools.length * 0.1) {
    // If we've filtered too aggressively, add more tools back
    const additionalTools = allTools
      .filter(tool => !relevantTools.includes(tool))
      .slice(0, Math.floor(allTools.length * 0.2));
      
    logWithTimestamp(`Adding ${additionalTools.length} additional tools to complement the ${relevantTools.length} relevant ones`);
    return [...relevantTools, ...additionalTools];
  }
  
  return relevantTools;
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

    // Get conversation history by following parent chain with improved handling
    async function getMessageChain(currentMessageId: string, depth: number = 0, maxDepth: number = 10): Promise<any[]> {
      // Safety check to prevent infinite recursion
      if (depth > 30) {
        logWithTimestamp('Warning: Reached maximum recursion depth when fetching message chain');
        return [];
      }
      
      // Get current message and direct children
      const { data: messages, error } = await supabase
        .from('conversation_messages')
        .select('*')
        .or(`id.eq.${currentMessageId},parent_message_id.eq.${currentMessageId}`)
        .order('created_at', { ascending: true });

      if (error) {
        logWithTimestamp('Error fetching message chain:', error);
        return [];
      }

      // Find the parent message if it exists
      const currentMessage = messages?.find(msg => msg.id === currentMessageId);
      if (!currentMessage) {
        logWithTimestamp(`Warning: Could not find message with ID ${currentMessageId}`);
        return messages || [];
      }
      
      // Get tool interaction messages connected to this message
      const toolInteractionMessages = messages?.filter(msg => 
        msg.parent_message_id === currentMessageId && msg.tool_calls !== null
      ) || [];
      
      // See if there is stored conversation history
      let storedHistory: any[] = [];
      if (currentMessage.conversation_history) {
        try {
          storedHistory = JSON.parse(currentMessage.conversation_history);
          logWithTimestamp(`Found stored conversation history with ${storedHistory.length} messages`);
        } catch (e) {
          logWithTimestamp('Error parsing stored conversation history:', e);
        }
      }
      
      // If we have stored history and we're at the first level, use it
      if (storedHistory.length > 0 && depth === 0) {
        logWithTimestamp('Using stored conversation history');
        return messages || [];
      }
      
      // If we have a parent and haven't reached max depth, get parent chain
      if (currentMessage.parent_message_id && depth < maxDepth) {
        const parentChain = await getMessageChain(
          currentMessage.parent_message_id, 
          depth + 1,
          maxDepth
        );
        
        // Combine parent chain with current messages
        return [...parentChain, ...messages];
      }

      return messages || [];
    }

    // Get the full conversation history
    const history = await getMessageChain(messageId);
    const uniqueHistory = Array.from(new Map(history.map(item => [item.id, item])).values());
    
    logWithTimestamp(`Retrieved ${uniqueHistory.length} messages in conversation chain`);

    // Check if the current message has stored conversation history
    const currentMessage = uniqueHistory.find(msg => msg.id === messageId);
    let conversationMessages: any[] = [];
    
    if (currentMessage?.conversation_history) {
      try {
        // Try to use stored conversation history first
        const storedHistory = JSON.parse(currentMessage.conversation_history);
        if (Array.isArray(storedHistory) && storedHistory.length > 0) {
          logWithTimestamp(`Using stored conversation history with ${storedHistory.length} messages`);
          conversationMessages = storedHistory;
        }
      } catch (e) {
        logWithTimestamp('Error parsing stored conversation history, will rebuild from messages:', e);
      }
    }
    
    // If we don't have valid stored history, build it from the messages
    if (conversationMessages.length === 0) {
      logWithTimestamp('Building conversation history from message chain');
      
      // First, get all tool interactions to ensure they're included
      const toolInteractions = uniqueHistory.filter(msg => msg.tool_calls !== null && msg.tool_calls.length > 0);
      
      // Include all messages but prioritize most recent ones
      const recentMessages = uniqueHistory
        .filter(msg => !toolInteractions.some(ti => ti.id === msg.id)) // exclude tool interactions to avoid duplication
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10) // Take most recent 10 messages
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // Sort back in chronological order
      
      // Combine and convert to Claude format
      const allMessages = [...recentMessages, ...toolInteractions].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      
      // Convert to Claude's message format
      conversationMessages = allMessages.map(msg => {
        const role: 'user' | 'assistant' = msg.direction === 'incoming' ? 'user' : 'assistant';
        
        // Check if it's a tool call message
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          // First check if the content is already a Claude-formatted message
          try {
            const parsedContent = JSON.parse(msg.content);
            if (parsedContent && typeof parsedContent === 'object') {
              return {
                role,
                content: parsedContent
              };
            }
          } catch (e) {
            // Not JSON, continue with normal processing
          }
          
          // Handle tool calls by creating a properly formatted message
          return {
            role: 'assistant' as const,
            content: [
              { type: 'text', text: typeof msg.content === 'string' ? msg.content : 'Tool result:' },
              ...msg.tool_calls
            ]
          };
        }
        
        return {
          role,
          content: msg.content
        };
      });
    }
    
    // Final messages array for Claude
    const messages = conversationMessages;
    
    // Connect to MCP
    const mcp = await ensureMcpConnection();
    
    // Create GoGuide client
    const goGuideClient = createGoGuideClient(mcp, supabase);
    
    // Get conversation context from the message history
    const messageContext = determineConversationContext(messages);
    logWithTimestamp(`Identified conversation context: ${messageContext}`);
    
    // Get relevant tools based on context
    const relevantTools = await getRelevantTools({ 
      ...message, 
      conversation_history: messages,
      request_text: message.content
    }, goGuideClient);
    
    // Add any specific tool suggestions based on the current message
    const suggestedTools = suggestToolsForMessage(message.content, await goGuideClient.getTools());
    
    // Use a Map to deduplicate tools by name
    const toolMap = new Map();
    
    // Add relevant tools to map (using name as key to ensure uniqueness)
    [...relevantTools, ...suggestedTools].forEach(tool => {
      if (!toolMap.has(tool.name)) {
        toolMap.set(tool.name, tool);
      }
    });
    
    // Convert back to array
    const uniqueTools = Array.from(toolMap.values());
    
    const tools = uniqueTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    
    logWithTimestamp(`Connected to MCP and prepared ${tools.length} relevant tools for context: ${messageContext}`);

    const messageWithCurrentContent = [...messages, { role: 'user' as const, content: message.content }];
    const estimatedTokens = estimateTokenCount(messageWithCurrentContent, tools);
    logWithTimestamp(`Estimated token count for Claude API call: ${estimatedTokens}`);
    
    // Log warning if token count is high
    if (estimatedTokens > 30000) {
      logWithTimestamp(`WARNING: High token count (${estimatedTokens}) may exceed limits`);
    }
    
    logWithTimestamp('Calling Claude with conversation history');
    // Call Claude with retry logic
    const response = await withRetry(
      () => anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        tools,
        tool_choice: {type: 'auto', disable_parallel_tool_use: false},
        messages: messageWithCurrentContent
      }),
      {
        maxRetries: 2,
        retryableErrors: ['rate limit', 'timeout', 'network error']
      }
    );
    logWithTimestamp('Received response from Claude');

    let finalResponse = '';
    let toolCalls = [];
    logWithTimestamp('Claude response:', response);
    
    // Type assertion needed for response content
    const responseContent = (response as any).content;
    logWithTimestamp('Claude content:', responseContent);

    // Process Claude's response
    for (const block of responseContent) {
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
          // Execute tool call with caching
          logWithTimestamp(`Executing tool: ${block.name}`);
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
          
          // Format the tool result for better user experience
          const formattedResult = formatToolResponse(block.name, toolResult);
          logWithTimestamp('Tool execution completed:', { 
            result: JSON.stringify(toolResult).substring(0, 200) + '...' 
          });

          // Create a new message for the tool result
          // Keep status as 'pending' so it can be picked up for further processing
          const { data: toolResultMessage } = await supabase
            .from('conversation_messages')
            .insert({
              profile_id: message.profile_id,
              phone_number: message.phone_number,
              direction: 'outgoing',
              content: formattedResult.text || JSON.stringify(toolResult),
              parent_message_id: messageId,
              tool_calls: [block],
              status: 'pending'
            })
            .select()
            .single();
          
          logWithTimestamp('Saved tool result to database');
          
          // Update the conversation history with the tool interaction
          messages.push(
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
          );

          // Send immediate tool result via SMS
          if (formattedResult.text) {
            logWithTimestamp('Sending formatted tool result via SMS');
            await supabase.functions.invoke('send-sms', {
              body: {
                to: message.phone_number,
                message: formattedResult.text
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
    // Add the final response to conversation history
    if (finalResponse.trim()) {
      messages.push({
        role: 'assistant' as const,
        content: finalResponse
      });
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
        conversation_history: JSON.stringify(messages),
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