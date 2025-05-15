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

// Validate and fix conversation history to ensure tool_use blocks are followed by tool_result blocks
function validateAndFixConversationHistory(messages: any[]): any[] {
  logWithTimestamp('Validating conversation history for proper tool use/result pairing');
  
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
    logWithTimestamp('Conversation history validation successful - all tool_use blocks have matching tool_result blocks');
    return messages;
  }
  
  // Log any tool_use blocks without tool_result blocks
  logWithTimestamp('WARNING: Found tool_use blocks without matching tool_result blocks:', {
    toolUseIds: toolUsesWithoutResults,
    messageCount: messages.length
  });
  
  // Try to fix the conversation by ensuring every tool_use has a matching tool_result
  logWithTimestamp('Attempting to fix conversation by adding missing tool_results');
  
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
          
          logWithTimestamp('Added synthetic tool_result for missing tool_use responses', {
            toolUseIds: toolUseBlocks.map((block: any) => block.id)
          });
        }
      }
    }
  }
  
  // Return the fixed conversation
  logWithTimestamp(`Fixed conversation history has ${fixedConversation.length} messages (was ${messages.length})`);
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
        
        // For tool result blocks, simplify content
        if (block.type === 'tool_result') {
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            // Replace content with a placeholder
            content: typeof block.content === 'string' && block.content.length > 100 
              ? `[Tool result for ${block.tool_use_id}]` 
              : block.content
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
      
      // We want to build conversation history from database messages, not use stored history
      // Even if we have stored history, we'll prioritize building from the database
      if (storedHistory.length > 0 && depth === 0) {
        logWithTimestamp('Found stored conversation history, but will use database history instead');
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
    
    // Check for tool_result_for to identify this as a tool result message
    const isToolResultMessage = currentMessage?.tool_result_for !== null && 
                               currentMessage?.tool_result_for !== undefined;
    
    if (isToolResultMessage) {
      logWithTimestamp('Processing a tool result message');
    }
    
    // We will log the stored history for debugging purposes but won't use it
    if (currentMessage?.conversation_history) {
      try {
        const storedHistory = JSON.parse(currentMessage.conversation_history);
        if (Array.isArray(storedHistory) && storedHistory.length > 0) {
          logWithTimestamp(`Found stored conversation history with ${storedHistory.length} messages, but will build from database instead`);
          // Log summary of the stored history for debugging
          logWithTimestamp('Stored conversation history summary:', {
            messageCount: storedHistory.length,
            firstMessageRole: storedHistory[0]?.role,
            lastMessageRole: storedHistory[storedHistory.length - 1]?.role,
            containsToolUse: storedHistory.some(m => 
              Array.isArray(m.content) && 
              m.content.some((c: any) => c.type === 'tool_use')
            ),
            containsToolResult: storedHistory.some(m => 
              Array.isArray(m.content) && 
              m.content.some((c: any) => c.type === 'tool_result')
            )
          });
        }
      } catch (e) {
        logWithTimestamp('Error parsing stored conversation history:', e);
      }
    }
    
    // Always rebuild conversation history from database messages
    // (we never use stored history, even if it exists)
    conversationMessages = [];
    logWithTimestamp('Building conversation history from database message chain');
    
    // First, get all tool interactions to ensure they're included
    const toolInteractions = uniqueHistory.filter(msg => 
      (msg.tool_calls !== null && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) ||
      (msg.content && (
        typeof msg.content === 'string' && msg.content.includes('tool_result') ||
        typeof msg.content === 'string' && msg.content.includes('Tool result')
      ))
    );
    
    // Also get tool results - messages that were created in response to tool calls
    const toolResultMessages = uniqueHistory.filter(msg => 
      msg.parent_message_id && 
      toolInteractions.some(ti => ti.id === msg.parent_message_id)
    );
    
    // Combine tool interactions and their results
    const allToolRelatedMessages = [...toolInteractions, ...toolResultMessages];
    
    // Include all messages but prioritize most recent ones
    const recentMessages = uniqueHistory
      .filter(msg => !allToolRelatedMessages.some(ti => ti.id === msg.id)) // exclude tool interactions to avoid duplication
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10) // Take most recent 10 regular messages
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // Sort back in chronological order
    
    // Combine and convert to Claude format
    const allMessages = [...recentMessages, ...allToolRelatedMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    logWithTimestamp(`Combined message history: ${recentMessages.length} recent messages + ${allToolRelatedMessages.length} tool-related messages`);
    
    // Convert to Claude's message format - ensuring proper tool_use and tool_result pairing
    conversationMessages = [];
    
    // Log details about the messages we're about to process
    logWithTimestamp('Messages from database being reconstructed into conversation history:', {
      messageCount: allMessages.length,
      regularMessages: allMessages.filter(msg => !msg.tool_calls || !Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0).length,
      toolCallMessages: allMessages.filter(msg => msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0).length,
      toolResultMessages: allMessages.filter(msg => msg.tool_result_for).length
    });
    
    // First, we'll collect the tool calls and their results in a structured way
    const toolCallMap = new Map();
    
    // Find all tool calls first
    for (const msg of allMessages) {
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          toolCallMap.set(toolCall.id, {
            toolCall,
            message: msg,
            result: null
          });
        }
      }
    }
    
    // Match tool results to their corresponding tool calls
    for (const msg of allMessages) {
      if (msg.tool_result_for && toolCallMap.has(msg.tool_result_for)) {
        const entry = toolCallMap.get(msg.tool_result_for);
        entry.result = msg;
      }
    }
    
    // Also check for parent-child relationships for tool results
    for (const msg of allMessages) {
      if (msg.parent_message_id) {
        const parentMsg = allMessages.find(m => m.id === msg.parent_message_id);
        if (parentMsg && parentMsg.tool_calls && Array.isArray(parentMsg.tool_calls) && parentMsg.tool_calls.length > 0) {
          // This might be a tool result for a parent with tool calls
          // If we don't already have a result, use this one
          for (const toolCall of parentMsg.tool_calls) {
            if (toolCallMap.has(toolCall.id)) {
              const entry = toolCallMap.get(toolCall.id);
              if (!entry.result && msg.direction === 'outgoing') {
                entry.result = msg;
              }
            }
          }
        }
      }
    }
    
    // Now build the conversation in proper order with regular messages first
    // First, process regular messages that are not tool calls or results
    for (const msg of allMessages) {
      const role: 'user' | 'assistant' = msg.direction === 'incoming' ? 'user' : 'assistant';
      
      // Skip tool-related messages - we'll handle them separately
      if ((msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) ||
          (msg.tool_result_for)) {
        continue;
      }
      
      // Skip messages that are likely tool results (based on parent relationship to tool call messages)
      const isToolResult = msg.parent_message_id && 
                          allMessages.some(m => 
                            m.id === msg.parent_message_id && 
                            m.tool_calls && 
                            Array.isArray(m.tool_calls) && 
                            m.tool_calls.length > 0);
      
      if (isToolResult) {
        continue;
      }
      
      // Add regular message
      conversationMessages.push({
        role,
        content: msg.content
      });
    }
    
    // Now add tool interactions in proper sequential pairs
    logWithTimestamp(`Processing ${toolCallMap.size} tool calls with their results`);
    
    // Convert the map to array and sort by message creation time to preserve chronological order
    const allToolInteractions = Array.from(toolCallMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.message.created_at).getTime();
        const bTime = new Date(b.message.created_at).getTime();
        return aTime - bTime;
      });
    
    for (const interaction of allToolInteractions) {
      const { toolCall, message, result } = interaction;
      
      // Log the tool interaction we're processing
      logWithTimestamp(`Processing tool interaction: ${toolCall.id}`, {
        toolName: toolCall.name,
        hasResult: !!result,
        resultContent: result ? result.content.substring(0, 50) + '...' : 'No result found'
      });
      
      // 1. First add the assistant message with tool_use
      conversationMessages.push({
        role: 'assistant' as const,
        content: [
          { type: 'text', text: typeof message.content === 'string' ? message.content : 'Using tool:' },
          { 
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input || toolCall.arguments || {} // Ensure input is always present
          }
        ]
      });
      
      // 2. IMMEDIATELY add the user message with tool_result (required by Claude API)
      conversationMessages.push({
        role: 'user' as const,
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result && typeof result.content === 'string' 
              ? result.content 
              : JSON.stringify({ status: 'success', result: 'Tool completed successfully' })
          }
        ]
      });
    }
    
    // Verify that tool_use and tool_result blocks are properly paired
    let toolUsesWithoutResults = [];
    
    for (let i = 0; i < conversationMessages.length - 1; i++) {
      const currentMsg = conversationMessages[i];
      const nextMsg = conversationMessages[i + 1];
      
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
    
    // Log any tool_use blocks without tool_result blocks
    if (toolUsesWithoutResults.length > 0) {
      logWithTimestamp('WARNING: Found tool_use blocks without matching tool_result blocks:', {
        toolUseIds: toolUsesWithoutResults,
        messageCount: conversationMessages.length
      });
      
      // Try to fix the conversation by ensuring every tool_use has a matching tool_result
      logWithTimestamp('Attempting to fix conversation by adding missing tool_results');
      
      // Create a fixed version of the conversation
      const fixedConversation = [];
      
      for (let i = 0; i < conversationMessages.length; i++) {
        const currentMsg = conversationMessages[i];
        fixedConversation.push(currentMsg);
        
        // If this is an assistant message with tool_use blocks
        if (currentMsg.role === 'assistant' && Array.isArray(currentMsg.content)) {
          const toolUseBlocks = currentMsg.content.filter((block: any) => block.type === 'tool_use');
          
          if (toolUseBlocks.length > 0) {
            // Check if the next message (if exists) is a user message with tool_result blocks
            const nextIsToolResult = i < conversationMessages.length - 1 && 
                                    conversationMessages[i + 1].role === 'user' && 
                                    Array.isArray(conversationMessages[i + 1].content) &&
                                    conversationMessages[i + 1].content.some((block: any) => block.type === 'tool_result');
            
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
              
              logWithTimestamp('Added synthetic tool_result for missing tool_use responses', {
                toolUseIds: toolUseBlocks.map((block: any) => block.id)
              });
            }
          }
        }
      }
      
      // Replace the conversation with the fixed version
      conversationMessages = fixedConversation;
    }
    
    // Final validation - log the structure of the conversation with tool use/result pairs
    let lastToolUseIds: string[] = [];
    logWithTimestamp('Final conversation structure:');
    for (let i = 0; i < conversationMessages.length; i++) {
      const msg = conversationMessages[i];
      
      if (Array.isArray(msg.content)) {
        const toolUses = msg.content
          .filter((block: any) => block.type === 'tool_use')
          .map((block: any) => block.id);
          
        const toolResults = msg.content
          .filter((block: any) => block.type === 'tool_result')
          .map((block: any) => block.tool_use_id);
          
        if (toolUses.length > 0) {
          lastToolUseIds = toolUses;
          logWithTimestamp(`Message ${i}: ${msg.role} with tool_use: ${toolUses.join(', ')}`);
        } else if (toolResults.length > 0) {
          // Check if each tool_result matches a previous tool_use
          const allMatch = toolResults.every((id: string) => lastToolUseIds.includes(id));
          logWithTimestamp(`Message ${i}: ${msg.role} with tool_result: ${toolResults.join(', ')} ${allMatch ? '✓' : '❌'}`);
          lastToolUseIds = [];
        }
      } else {
        logWithTimestamp(`Message ${i}: ${msg.role} with text content`);
      }
    }
    
    // We've already added messages in the proper order, so we don't need to sort them here
    // The previous sorting approach wouldn't work well with tool use/result messages anyway
    logWithTimestamp(`Final conversation history contains ${conversationMessages.length} messages`);
    
    // Debug last message to ensure proper pairing
    if (conversationMessages.length >= 2) {
      const lastTwoMessages = conversationMessages.slice(-2);
      logWithTimestamp('Last two messages in history:', {
        secondLast: {
          role: lastTwoMessages[0].role,
          contentType: typeof lastTwoMessages[0].content === 'string' ? 'text' : 'array',
          content: lastTwoMessages[0].content
        },
        last: {
          role: lastTwoMessages[1].role,
          contentType: typeof lastTwoMessages[1].content === 'string' ? 'text' : 'array',
          content: lastTwoMessages[1].content
        }
      });
    }
    
    // De-duplicate messages
    conversationMessages = Array.from(
      new Map(conversationMessages.map((msg, index) => [JSON.stringify(msg), msg])).values()
    );
    
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
    
    // We make this variable so it can be modified later if needed
    let tools = uniqueTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
    
    logWithTimestamp(`Connected to MCP and prepared ${tools.length} relevant tools for context: ${messageContext}`);

    // Validate and fix conversation history before cleaning
    const validatedMessages = validateAndFixConversationHistory(messages);
    
    // Clean conversation history to reduce token usage
    const cleanedMessages = cleanConversationHistory(validatedMessages);
    const messageWithCurrentContent = [...cleanedMessages, { role: 'user' as const, content: message.content }];
    
    const estimatedTokens = estimateTokenCount(messageWithCurrentContent, tools);
    logWithTimestamp(`Estimated token count for Claude API call: ${estimatedTokens}`);
    
    // Log warning if token count is high
    if (estimatedTokens > 30000) {
      logWithTimestamp(`WARNING: High token count (${estimatedTokens}) may exceed limits`);
    }
    
    logWithTimestamp('Calling Claude with cleaned conversation history');
    
    console.log('Sending messages to Claude with the following history:', messageWithCurrentContent);
    
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
    logWithTimestamp('Claude content structure:', JSON.stringify(responseContent, null, 2));
    
    // Log more detailed structure of response content
    responseContent.forEach((block: any, index: number) => {
      logWithTimestamp(`Response block ${index}:`, {
        type: block.type,
        hasInput: block.type === 'tool_use' && !!block.input,
        hasArguments: block.type === 'tool_use' && !!block.arguments,
        contentSample: block.type === 'text' ? 
          block.text.substring(0, 50) + '...' : 
          JSON.stringify(block).substring(0, 50) + '...'
      });
    });

    // Process Claude's response
    for (const block of responseContent) {
      if (block.type === 'text') {
        finalResponse += block.text + '\n';
        logWithTimestamp('Received text response from Claude:', {
          text: block.text.substring(0, 100) + '...' // Log first 100 chars
        });
      } else if (block.type === 'tool_use') {
        // Ensure the block has a type field set to 'tool_use'
        block.type = 'tool_use'; // This ensures consistency even if the API changes
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
          // Execute tool call with caching and better error handling
          logWithTimestamp(`Executing tool: ${block.name} with ID: ${block.id}`);
          
          // Log the message context when running the tool
          logWithTimestamp('Current message context before tool execution:', {
            messagesCount: messages.length,
            latestMessages: messages.slice(-2).map(m => ({
              role: m.role,
              contentType: typeof m.content === 'string' ? 'text' : 'array',
              contentPreview: typeof m.content === 'string' 
                ? m.content.substring(0, 100) + '...' 
                : JSON.stringify(m.content).substring(0, 100) + '...'
            })),
            toolInput: block.input
          });
          
          let toolResult;
          try {
            toolResult = await cachedToolCall(
              block.name,
              block.input as Record<string, unknown>,
              () => mcp.callTool({
                id: block.id,
                name: block.name,
                arguments: block.input as Record<string, unknown>,
                tool_result: []
              })
            );
          } catch (error) {
            // Cast the unknown error to a type with message property
            const toolError = error as { message?: string };
            
            // Handle MCP "Tool not found" errors - typically when tool IDs don't match
            if (toolError.message && 
                typeof toolError.message === 'string' && 
                toolError.message.includes('Tool') && 
                toolError.message.includes('not found')) {
              logWithTimestamp(`Tool ID error - attempting to find correct tool ID for: ${block.name}`);
              
              try {
                // Get available tools from MCP server
                const availableTools = await goGuideClient.getTools();
                
                // Find matching tool by name
                const matchingTool = availableTools.find(tool => 
                  tool.name.toLowerCase() === block.name.toLowerCase() || 
                  tool.name.replace(/\s+/g, '') === block.name.replace(/\s+/g, '')
                );
                
                if (matchingTool) {
                  logWithTimestamp(`Found matching tool with ID: ${matchingTool.id || 'unknown'}`);
                  
                  toolResult = await cachedToolCall(
                    block.name,
                    block.input as Record<string, unknown>,
                    () => mcp.callTool({
                      // Use the correct tool ID from the server
                      id: matchingTool.id || block.name,
                      name: matchingTool.name, // Use the exact name from the server
                      arguments: block.input as Record<string, unknown>,
                      tool_result: []
                    })
                  );
                } else {
                  // No matching tool found, try with a generated ID
                  const fallbackId = `${block.name.replace(/\s+/g, '_')}_${Date.now()}`;
                  logWithTimestamp(`No matching tool found, using fallback ID: ${fallbackId}`);
                  
                  toolResult = await cachedToolCall(
                    block.name,
                    block.input as Record<string, unknown>,
                    () => mcp.callTool({
                      id: fallbackId,
                      name: block.name,
                      arguments: block.input as Record<string, unknown>,
                      tool_result: []
                    })
                  );
                }
              } catch (error) {
                const retryError = error as { message?: string };
                logWithTimestamp(`Retry also failed: ${retryError.message || 'Unknown error'}`);
                throw error;
              }
            } else {
              // Rethrow other errors
              throw error;
            }
          }
          
          // Format the tool result for better user experience
          const formattedResult = formatToolResponse(block.name, toolResult);
          
          // Log detailed information about tool results
          logWithTimestamp('Tool execution completed with results:', { 
            toolName: block.name,
            toolId: block.id,
            rawResult: JSON.stringify(toolResult).substring(0, 200) + '...',
            formattedResult: formattedResult.text ? formattedResult.text.substring(0, 200) + '...' : 'No formatted text'
          });

          // Update conversation history before creating the tool result message
          
          // Log the conversation history that will be stored with the tool result
          logWithTimestamp('Storing conversation history with tool result:', {
            messageCount: messages.length,
            latestMessages: messages.slice(-2).map(m => ({
              role: m.role,
              contentType: typeof m.content === 'string' ? 'text' : 'array',
              contentPreview: typeof m.content === 'string' 
                ? m.content.substring(0, 50) + '...' 
                : JSON.stringify(m.content).substring(0, 50) + '...'
            })),
            historyHasToolUse: messages.some(m => 
              Array.isArray(m.content) && 
              m.content.some((c: any) => c.type === 'tool_use')
            ),
            historyHasToolResult: messages.some(m => 
              Array.isArray(m.content) && 
              m.content.some((c: any) => c.type === 'tool_result')
            )
          });
          
          // Create a new message for the tool result
          // Keep status as 'pending' so it can be picked up for further processing
          const { data: toolResultMessage, error: toolResultError } = await supabase
            .from('conversation_messages')
            .insert({
              profile_id: message.profile_id,
              phone_number: message.phone_number,
              direction: 'outgoing',
              content: formattedResult.text || JSON.stringify(toolResult),
              parent_message_id: messageId,
              // Don't set tool_calls for result messages - this avoids confusion
              // between tool_use and tool_result messages
              tool_result_for: block.id, // Add this field to track which tool call this result is for
              conversation_history: JSON.stringify(messages), // Include conversation history for context
              status: 'pending'
            })
            .select()
            .single();
          
          if (toolResultError) {
            throw new Error(`Failed to create tool result message: ${toolResultError.message}`);
          }
          
          logWithTimestamp('Saved tool result to database', { toolResultMessageId: toolResultMessage?.id });
          
          // Update the conversation history with the tool interaction
          // Claude requires a specific format - tool_use blocks in assistant messages
          // must be followed immediately by tool_result blocks in user messages with matching IDs
          
          // Create an array to hold the new messages
          const messagesBeforeToolAddition = [...messages];
          
          // First, add the assistant message with the tool_use block
          const assistantMessage = {
            role: 'assistant' as const,
            content: [
              { type: 'text', text: finalResponse || 'Using tool:' },
              { 
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input || block.arguments || {} // Ensure input is always present
              }
            ]
          };
          
          // Create the user message with the tool_result block
          const userMessage = {
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
          };
          
          // Add the new messages to the array
          messages.push(assistantMessage);
          messages.push(userMessage);
          
          // Log to verify proper sequential addition
          logWithTimestamp('Added tool use/result pair to conversation history:', {
            toolId: block.id,
            toolName: block.name,
            previousMessageCount: messagesBeforeToolAddition.length,
            newMessageCount: messages.length,
            lastMessages: messages.slice(-2).map(m => m.role)
          });
          
          // Log the updated conversation history for debugging
          logWithTimestamp(`Added tool interaction to conversation history: ${block.name}`);
          logWithTimestamp(`Created tool_use with ID: ${block.id} and matching tool_result`);
          logWithTimestamp('Updated conversation history now contains:', {
            messageCount: messages.length,
            lastTwoMessages: messages.slice(-2).map(m => ({
              role: m.role,
              contentType: typeof m.content === 'string' ? 'text' : 'array',
              contentSummary: Array.isArray(m.content) ? 
                m.content.map((c: any) => c.type).join(', ') : 
                (typeof m.content === 'string' ? 
                  m.content.substring(0, 30) + '...' : 
                  'unknown content type')
            }))
          });

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
          
          // For the next call, only include the specific tool that was just called
          // This drastically reduces context size when processing tool results
          logWithTimestamp(`Filtering tools to only include ${block.name} for next API call`);
          
          // Find the specific tool definition
          const specificTool = tools.find(tool => tool.name === block.name);
          if (specificTool) {
            // Replace the full tools list with just this one tool
            tools = [specificTool];
            logWithTimestamp('Successfully filtered to single tool for next API call');
          } else {
            logWithTimestamp('Could not find matching tool definition - using all tools');
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          
          // Enhanced error logging
          logWithTimestamp('Tool execution failed:', { 
            error: errorMessage,
            toolName: block.name,
            toolId: block.id,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
          });
          
          // Add more detailed information about tool format to help with debugging
          logWithTimestamp('Tool call format that caused error:', {
            toolBlock: JSON.stringify(block, null, 2),
            hasInput: !!block.input,
            hasArguments: !!block.arguments,
            inputType: block.input ? typeof block.input : 'undefined',
            argumentsType: block.arguments ? typeof block.arguments : 'undefined'
          });
          
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
    
    // Create response message - formatting is crucial for Claude compatibility
    await supabase
      .from('conversation_messages')
      .insert({
        profile_id: message.profile_id,
        phone_number: message.phone_number,
        direction: 'outgoing',
        content: finalResponse,
        parent_message_id: messageId,
        // Store tool calls in a standard format - we'll handle formatting for Claude separately
        tool_calls: toolCalls.length > 0 ? toolCalls.map(call => ({
          id: call.id,
          name: call.name,
          input: call.arguments,
          // Do NOT include the 'type' field here - it gets added dynamically
          // when formatting messages for Claude
        })) : null,
        conversation_history: JSON.stringify(messages),
        status: 'completed'
      });

    // Check for any existing unprocessed tool result messages related to this message
    async function checkPendingToolResults(originalMessageId: string): Promise<boolean> {
      const { data: pendingResults, error } = await supabase
        .from('conversation_messages')
        .select('id, status')
        .eq('parent_message_id', originalMessageId)
        .eq('status', 'pending')
        .not('tool_result_for', 'is', null);
      
      if (error) {
        logWithTimestamp('Error checking pending tool results:', { error });
        return false;
      }
      
      return (pendingResults && pendingResults.length > 0);
    }
    
    const hasPendingToolResults = await checkPendingToolResults(messageId);
    
    // Only mark the original message as completed if no tool calls were made
    // and no tool results are pending
    if (toolCalls.length === 0 && !hasPendingToolResults) {
      await supabase
        .from('conversation_messages')
        .update({ status: 'completed' })
        .eq('id', messageId);
      logWithTimestamp('Updated original message status to completed - no tool calls made');
    } else {
      // If tool calls were made, keep the message as processing
      // This allows us to verify that tool result messages are being processed
      await supabase
        .from('conversation_messages')
        .update({ 
          status: 'processing',
          tool_calls: toolCalls
        })
        .eq('id', messageId);
      
      if (toolCalls.length > 0) {
        logWithTimestamp('Keeping original message in processing state - tool calls were made');
      }
      if (hasPendingToolResults) {
        logWithTimestamp('Keeping original message in processing state - pending tool results exist');
      }
    }

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

      // 30-second delay between retry attempts
      await new Promise(resolve => setTimeout(resolve, 30000));
    } catch (error) {
      logWithTimestamp('Error in worker loop:', { error });
      // Add 30-second delay on error to prevent rapid retries
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

// Start the worker
logWithTimestamp('Starting message processing worker...');
workerLoop().catch(error => {
  logWithTimestamp('Fatal error in worker:', { error });
  process.exit(1);
});