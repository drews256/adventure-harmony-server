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

// Import the simplified tool handlers
import { 
  buildConversationHistoryWithTools,
  formatToolResponsesForClaude,
  processToolCallsFromClaude,
  filterToolParameters
} from './simplified-tool-handler';

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

// Log helper function removed - using console.error for errors only

// Validate and fix conversation history to ensure tool_use blocks are followed by tool_result blocks
function validateAndFixConversationHistory(messages: any[]): any[] {
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
    return messages;
  }
  
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
          // Even when adding synthetic tool results, we need to preserve any existing results
          const toolResultsContent = toolUseBlocks.map((toolUse: any) => {
            // Check if we already have a result for this tool use
            // Note: messages is available in this scope
            const existingResult = messages.find((msg: any) => 
              msg.tool_result_for === toolUse.id && 
              typeof msg.content === 'string'
            );
            
            return {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              // Use the actual tool result if we have it
              content: existingResult?.content || JSON.stringify({ status: 'success', result: 'Tool completed successfully' })
            };
          });
          
          fixedConversation.push({
            role: 'user' as const,
            content: toolResultsContent
          });
        }
      }
    }
  }
  
  // Return the fixed conversation
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

// Estimate token count for API calls with breakdown for messages and tools
function estimateTokenCount(messages: any[], tools: any[]): { total: number, messageTokens: number, toolTokens: number } {
  // Simple approximation: 4 chars ≈ 1 token for English text
  const messageText = messages
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    .join(' ');
  
  const toolText = JSON.stringify(tools);
  
  // Calculate tokens for each component
  const messageTokens = Math.ceil(messageText.length / 4);
  const toolTokens = Math.ceil(toolText.length / 4);
  
  // Log detailed breakdown
  console.log(`Token breakdown - Messages: ${messageTokens} tokens (${messageText.length} chars), Tools: ${toolTokens} tokens (${toolText.length} chars)`);
  
  // Return detailed token information
  return {
    total: messageTokens + toolTokens,
    messageTokens,
    toolTokens
  };
}

// Filter tools based on message content
function filterToolsByContent(allTools: any[], messageContent: string): any[] {
  if (!allTools || allTools.length === 0) {
    return []; // Return empty array if no tools
  }

  // OVERRIDE: Only include OrderLines and Tokens tools
  const filteredTools = allTools.filter(tool => {
    const toolName = (tool.name || '').toLowerCase();
    const toolDesc = (tool.description || '').toLowerCase();

    // Check if the tool name or description contains "orderline" or "token"
           return toolName.includes('order') ||
           toolDesc.includes('order') ||
           toolName.includes('search') ||
           toolDesc.includes('search') ||
           toolName.includes('token') ||
           toolDesc.includes('token');
  });

  // If we didn't find any tools matching our criteria, return a minimal set
  if (filteredTools.length === 0) {
    console.log('No tools found, returning minimal set');
    return allTools.slice(0, 5);
  }
  
  return filteredTools;
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

    // Get conversation history by following parent chain with improved handling
    async function getMessageChain(currentMessageId: string, depth: number = 0, maxDepth: number = 10): Promise<any[]> {
      // Safety check to prevent infinite recursion
      if (depth > 30) {
        return [];
      }
      
      // Get current message and direct children
      const { data: messages, error } = await supabase
        .from('conversation_messages')
        .select('*')
        .or(`id.eq.${currentMessageId},parent_message_id.eq.${currentMessageId}`)
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`Error fetching message chain: ${error}`);
        return [];
      }

      // Find the parent message if it exists
      const currentMessage = messages?.find(msg => msg.id === currentMessageId);
      if (!currentMessage) {
        return messages || [];
      }
      
      // See if there is stored conversation history
      let storedHistory: any[] = [];
      if (currentMessage.conversation_history) {
        try {
          storedHistory = JSON.parse(currentMessage.conversation_history);
        } catch (e) {
          console.error('Error parsing stored conversation history:', e);
        }
      }
      
      // We want to build conversation history from database messages, not use stored history
      // Even if we have stored history, we'll prioritize building from the database
      
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
    
    // Log details about the message history loaded from the database
    console.log('===== DATABASE MESSAGE HISTORY =====');
    console.log(`Total messages loaded from database: ${history.length}`);
    console.log(`Unique messages after deduplication: ${uniqueHistory.length}`);
    
    // Count message direction
    const directionCounts = uniqueHistory.reduce((acc, msg) => {
      acc[msg.direction || 'unknown'] = (acc[msg.direction || 'unknown'] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(`Message direction breakdown:`, JSON.stringify(directionCounts, null, 2));
    
    // Log the current message being processed
    const currentMsg = uniqueHistory.find(msg => msg.id === messageId);
    if (currentMsg) {
      console.log(`Current message being processed:`);
      console.log(`ID: ${currentMsg.id}, Direction: ${currentMsg.direction}`);
      console.log(`Content: ${typeof currentMsg.content === 'string' 
        ? (currentMsg.content.length > 100 ? currentMsg.content.substring(0, 100) + '...' : currentMsg.content)
        : 'Complex content'}`);
    }
    console.log('===== END DATABASE MESSAGE HISTORY =====');
    

    // Check if the current message has stored conversation history
    const currentMessage = uniqueHistory.find(msg => msg.id === messageId);
    let conversationMessages: any[] = [];
    
    // Check for tool_result_for to identify this as a tool result message
    const isToolResultMessage = currentMessage?.tool_result_for !== null && 
                               currentMessage?.tool_result_for !== undefined;
    
    
    // Always rebuild conversation history from database messages
    // (we never use stored history, even if it exists)
    conversationMessages = [];
    
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
    
    // Get ALL messages for this phone number, not just those in the current conversation chain
    // This allows us to include messages outside the current chain
    const { data: allPhoneMessages, error: allMessagesError } = await supabase
      .from('conversation_messages')
      .select('*')
      .eq('phone_number', message.phone_number)
      .order('created_at', { ascending: false })
      .limit(50);  // Increased limit to include more message history
      
    if (allMessagesError) {
      console.error('Error fetching all phone messages:', allMessagesError);
    }
    
    // Process all messages, including those outside current chain
    const allMessagesArray = allPhoneMessages || [];
    
    // Combine all message sources, prioritizing tool-related messages
    const regularMessages = [
      ...uniqueHistory.filter(msg => !allToolRelatedMessages.some(ti => ti.id === msg.id)), // Current chain
      ...allMessagesArray.filter(msg => 
        // Only include messages not already in the history and not tool-related
        !uniqueHistory.some(h => h.id === msg.id) && 
        !allToolRelatedMessages.some(ti => ti.id === msg.id)
      )
    ];
    
    // Sort and take most recent messages, but include more to capture those outside the chain
    const recentMessages = regularMessages
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 25) // Take more messages to include those outside the chain
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); // Sort back in chronological order
    
    // Combine and convert to Claude format
    const allMessages = [...recentMessages, ...allToolRelatedMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    
    // Use the simplified tool handler to build conversation messages
    console.log('=== BUILDING CONVERSATION MESSAGES WITH SIMPLIFIED APPROACH ===');
    conversationMessages = buildConversationHistoryWithTools(allMessages);
    console.log(`Built conversation history with ${conversationMessages.length} messages`);
    console.log('=== COMPLETED BUILDING CONVERSATION MESSAGES ===');

    // Log conversation history construction
    console.log('===== CONVERSATION HISTORY CONSTRUCTION =====');
    console.log(`Total conversation messages constructed: ${conversationMessages.length}`);
    console.log(`Breakdown of message roles in constructed history:`);
    const constructedRoleCounts = conversationMessages.reduce((acc, msg) => {
      acc[msg.role] = (acc[msg.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(JSON.stringify(constructedRoleCounts, null, 2));
    
    // Log message types in the history (text vs tool-related)
    const textMsgCount = conversationMessages.filter(msg => typeof msg.content === 'string').length;
    const complexMsgCount = conversationMessages.filter(msg => Array.isArray(msg.content)).length;
    console.log(`Text-only messages: ${textMsgCount}, Complex messages (tool use/result): ${complexMsgCount}`);
    
    // Log the oldest 3 and newest 3 messages for context
    if (conversationMessages.length > 0) {
      console.log('First 3 messages in conversation history:');
      for (let i = 0; i < Math.min(3, conversationMessages.length); i++) {
        const msg = conversationMessages[i];
        console.log(`[${i}] Role: ${msg.role}, Content type: ${typeof msg.content === 'string' ? 'text' : 'array'}`);
        if (typeof msg.content === 'string') {
          console.log(`  Preview: ${msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content}`);
        }
      }
      
      console.log('Last 3 messages in conversation history:');
      for (let i = Math.max(0, conversationMessages.length - 3); i < conversationMessages.length; i++) {
        const msg = conversationMessages[i];
        console.log(`[${i}] Role: ${msg.role}, Content type: ${typeof msg.content === 'string' ? 'text' : 'array'}`);
        if (typeof msg.content === 'string') {
          console.log(`  Preview: ${msg.content.length > 50 ? msg.content.substring(0, 50) + '...' : msg.content}`);
        }
      }
    }
    console.log('===== END CONVERSATION HISTORY CONSTRUCTION =====');
    
    // Conversation messages are now cleaned up and ready for use
    
    // Final messages array for Claude
    const messages = conversationMessages;
    
    // Connect to MCP
    const mcp = await ensureMcpConnection();
    
    // Create GoGuide client
    const goGuideClient = createGoGuideClient(mcp, supabase);
    
    const allTools = await goGuideClient.getTools();

    // Apply our filter to specifically include only OrderLine and Token tools
    const filteredUniqueTools = filterToolsByContent(allTools, "orderline token");
    
    // We make this variable so it can be modified later if needed
    // Filter tool parameters - remove unnecessary input options
    let tools = filterToolParameters(filteredUniqueTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    })));

    // Validate and fix conversation history before cleaning
    const validatedMessages = validateAndFixConversationHistory(messages);
    
    // Clean conversation history to reduce token usage
    const cleanedMessages = cleanConversationHistory(validatedMessages);
    
    // Add instructions to reference all previous messages and use existing tool results
    const enhancedPrompt = `
    The primary interface you're corresponding with is through text messages. 

    It's relatively important that you keep your responses short and to the point to that we can handle it like the text message that it is.

    Also - don't refer to the tools by name - that's confusing. Refer to the tools using concepts that are relatable to someone running an outfitting business.  

    You're corresponding with a client who is managing an outfitter, that outfitter has a website and accepts bookings (also called orders or orderlines). They present those offerings as listings in a plugin page on their websites and we accept bookings in many ways. We can create bookings through the plugin on their website, or we can create bookings through the phone, they can also create manual bookings through the website. Sometimes they create completely custom bookings that don't relate to listings too.  

    I'm reviewing our conversation history. Please reference ALL previous messages in your response, including ones that might seem to be from a separate conversation. 

Don't be confused by messages that seem unrelated - I expect you to have access to my entire message history, so treat all previous messages as relevant context.

IMPORTANT: Before using tools, check if you've already used similar tools in previous messages. If relevant tool results already exist in our conversation history, use that information instead of making duplicate tool calls. This will save time and provide a better experience.

For example, if you see I previously asked about generating a token and you already fetched that information, don't fetch it again - just reference the existing results and continue the conversation.

Here's my current message: ${message.content}`;
    
    // Create initial message array
    let messageWithCurrentContent = [...cleanedMessages, { role: 'user' as const, content: enhancedPrompt }];
    
    // Check token count
    let tokenInfo = estimateTokenCount(messageWithCurrentContent, tools);
    console.log(`Initial estimated token count: ${tokenInfo.total} (Messages: ${tokenInfo.messageTokens}, Tools: ${tokenInfo.toolTokens})`);
    
    // If token count is too high, reduce the number of messages from oldest to newest
    if (tokenInfo.total > 30000) {
      console.log('===== TOKEN REDUCTION PROCESS =====');
      console.log('Token count is high (>30k), reducing message history to fit within token limits');
      console.log(`Original message count: ${messageWithCurrentContent.length}`);
      
      // Log the distribution of message roles before reduction
      const preReductionRoles = messageWithCurrentContent.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(`Pre-reduction role distribution:`, JSON.stringify(preReductionRoles, null, 2));
      
      // Keep the newest 50% of regular messages by default
      let messagesToKeep = Math.ceil(cleanedMessages.length * 0.5);
      
      // Try different reductions until we get under 30k tokens
      while (tokenInfo.total > 30000 && messagesToKeep > 5) {
        // Get the most recent messages, prioritizing tool results
        const toolMessages = cleanedMessages.filter(msg => 
          Array.isArray(msg.content) && 
          msg.content.some((block: any) => block.type === 'tool_use' || block.type === 'tool_result')
        );
        
        // Regular text messages (sort by recency - newest first)
        const textMessages = cleanedMessages
          .filter(msg => !Array.isArray(msg.content))
          .slice(-messagesToKeep); // Keep only most recent messages
        
        // Reconstruct with reduced message count, maintaining chronological order
        const reducedMessages = [...toolMessages, ...textMessages]
          .sort((a, b) => {
            // Simple sort based on position in the original array
            return cleanedMessages.indexOf(a) - cleanedMessages.indexOf(b);
          });
        
        // Create new message array with reduced history
        messageWithCurrentContent = [...reducedMessages, { role: 'user' as const, content: enhancedPrompt }];
        
        // Recalculate token count
        tokenInfo = estimateTokenCount(messageWithCurrentContent, tools);
        console.log(`Reduced to ${reducedMessages.length} messages, new token count: ${tokenInfo.total} (Messages: ${tokenInfo.messageTokens}, Tools: ${tokenInfo.toolTokens})`);
        
        // Reduce by another 5 messages if still too large
        messagesToKeep -= 5;
      }
      
      // If we still can't get under the limit, add a warning to the prompt
      if (tokenInfo.total > 30000) {
        // Add warning about limited history
        const reducedPrompt = `NOTE: Due to the large conversation history, I only have access to the most recent messages. Some earlier context may be missing.

${enhancedPrompt}`;
        
        // Replace the last message with the reduced prompt
        messageWithCurrentContent[messageWithCurrentContent.length - 1].content = reducedPrompt;
        
        // Final token count
        tokenInfo = estimateTokenCount(messageWithCurrentContent, tools);
        console.log(`Final reduction with warning message, token count: ${tokenInfo.total} (Messages: ${tokenInfo.messageTokens}, Tools: ${tokenInfo.toolTokens})`);
      }
      
      // If tools are taking up a lot of tokens, provide a warning and suggestion
      if (tokenInfo.toolTokens > 10000) {
        console.log(`WARNING: Tools are using ${tokenInfo.toolTokens} tokens (${Math.round(tokenInfo.toolTokens/tokenInfo.total*100)}% of total). Consider reducing the number of tools or simplifying tool schemas.`);
      }
      
      // Log the final message distribution after reduction
      const postReductionRoles = messageWithCurrentContent.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      console.log(`Post-reduction role distribution:`, JSON.stringify(postReductionRoles, null, 2));
      console.log(`Final message count: ${messageWithCurrentContent.length}`);
      console.log('===== END TOKEN REDUCTION PROCESS =====');
    }
    // Log detailed information about the message context being sent to Claude
    console.log('===== MESSAGE CONTEXT DETAILS =====');
    console.log(`Total messages being sent to Claude: ${messageWithCurrentContent.length}`);
    console.log('Message roles breakdown:');
    const roleCounts = messageWithCurrentContent.reduce((acc, msg) => {
      acc[msg.role] = (acc[msg.role] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log(JSON.stringify(roleCounts, null, 2));
    
    // Log the last 5 messages for context (or all if less than 5)
    const lastN = Math.min(5, messageWithCurrentContent.length);
    console.log(`Last ${lastN} messages being sent to Claude:`);
    for (let i = messageWithCurrentContent.length - lastN; i < messageWithCurrentContent.length; i++) {
      const msg = messageWithCurrentContent[i];
      console.log(`[${i}] Role: ${msg.role}, Content: ${typeof msg.content === 'string' 
        ? (msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content)
        : 'Array content (contains tool use/result)'}`);
    }
    
    // Log detailed information about tool-related messages
    const toolUseMessagesInContext = messageWithCurrentContent.filter(msg => 
      Array.isArray(msg.content) && 
      msg.content.some((block: any) => block.type === 'tool_use')
    );
    const toolResultMessagesInContext = messageWithCurrentContent.filter(msg => 
      Array.isArray(msg.content) && 
      msg.content.some((block: any) => block.type === 'tool_result')
    );
    
    console.log(`Number of tool_use messages: ${toolUseMessagesInContext.length}`);
    console.log(`Number of tool_result messages: ${toolResultMessagesInContext.length}`);
    console.log('===== END MESSAGE CONTEXT DETAILS =====');
    
    // Call Claude with retry logic
    const response = await withRetry(
      () => anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        temperature: 0.7,
        tools,
        tool_choice: {type: 'auto', disable_parallel_tool_use: false},
        messages: messageWithCurrentContent
      }),
      {
        maxRetries: 2,
        retryableErrors: ['rate limit', 'timeout', 'network error']
      }
    );
    
    // Log the Claude response
    console.log('CLAUDE RESPONSE:', JSON.stringify(response, null, 2));

    let finalResponse = '';
    let toolCalls = [];
    
    // Type assertion needed for response content
    const responseContent = (response as any).content;
    

    // Process Claude's response using the simplified tool handler
    console.log('=== PROCESSING CLAUDE RESPONSE BLOCKS ===');
    
    try {
      // Use our simplified tool handler to process the response
      const result = await processToolCallsFromClaude(
        responseContent, 
        supabase, 
        mcp, 
        message, 
        messageId
      );
      
      // Extract the results
      finalResponse = result.finalResponse;
      toolCalls = result.toolCalls;
      
      // Add the new messages to our conversation history
      for (const msg of result.messages) {
        messages.push(msg);
      }
      
      console.log(`Processed ${toolCalls.length} tool calls from Claude's response`);
      console.log(`Final text response: ${finalResponse.length > 100 ? finalResponse.substring(0, 100) + "..." : finalResponse}`);
    } catch (error) {
      console.error('Error processing Claude response:', error);
      finalResponse = `Sorry, I encountered an error processing the response. ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
    
    console.log('=== COMPLETED PROCESSING CLAUDE RESPONSE ===');
    
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
        console.error('Error checking pending tool results:', error);
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
      
    }

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

      // 30-second delay between retry attempts
      await new Promise(resolve => setTimeout(resolve, 30000));
    } catch (error) {
      console.error('Error in worker loop:', error);
      // Add 30-second delay on error to prevent rapid retries
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

// Start the worker
workerLoop().catch(error => {
  console.error('Fatal error in worker:', error);
  process.exit(1);
});