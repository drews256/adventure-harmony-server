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
          const toolResultsContent = toolUseBlocks.map((toolUse: any) => ({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ status: 'success', result: 'Tool completed successfully' })
          }));
          
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
           toolName.includes('order') ||
           toolDesc.includes('order') ||
           toolName.includes('search') ||
           toolDesc.includes('search') ||
           toolName.includes('token') ||
           toolDesc.includes('token');
  });
  
  // If we didn't find any tools matching our criteria, return a minimal set
  if (filteredTools.length === 0) {
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
    
    
    // Convert to Claude's message format - ensuring proper tool_use and tool_result pairing
    conversationMessages = [];
    
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
    
    // Simple approach: first add all text messages (non-tool messages)
    // For each message, check if it's a regular text message (not a tool call/result)
    for (const msg of allMessages) {
      // Skip if this is a tool call or tool result message - we'll handle those separately
      if ((msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) ||
          (msg.tool_result_for)) {
        continue;
      }
      
      // Add all regular text messages (both user and assistant)
      const role = msg.direction === 'incoming' ? 'user' : 'assistant';
      
      // Add the message
      conversationMessages.push({
        role,
        content: msg.content
      });
    }
    
    // Now add tool interactions in proper sequential pairs
    
    // Convert the map to array and sort by message creation time to preserve chronological order
    const allToolInteractions = Array.from(toolCallMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.message.created_at).getTime();
        const bTime = new Date(b.message.created_at).getTime();
        return aTime - bTime;
      });
    
    for (const interaction of allToolInteractions) {
      const { toolCall, message, result } = interaction;
      
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
              
              // Added synthetic tool_result for missing tool_use responses
            }
          }
        }
      }
      
      // Replace the conversation with the fixed version
      conversationMessages = fixedConversation;
    }
    
    // Final validation - log the structure of the conversation with tool use/result pairs
    let lastToolUseIds: string[] = [];
    // Final validation completed successfully
    
    // We've already added messages in the proper order, so we don't need to sort them here
    // The previous sorting approach wouldn't work well with tool use/result messages anyway
    
    // De-duplicate messages
    conversationMessages = Array.from(
      new Map(conversationMessages.map((msg, index) => [JSON.stringify(msg), msg])).values()
    );

    // Ensure all incoming messages are included
    const allIncomingMessages = allMessages.filter(msg => msg.direction === 'incoming');
    
    // Find which incoming messages made it to the final conversation
    const includedIncomingMessageIds = conversationMessages
      .filter(msg => msg.role === 'user' && typeof msg.content === 'string')
      .map(msg => JSON.stringify(msg.content));
    
    // Find any missing incoming messages
    const missingIncomingMessages = allIncomingMessages.filter(msg => 
      !includedIncomingMessageIds.includes(JSON.stringify(msg.content))
    );
    
    // If we found any missing incoming messages, add them now
    if (missingIncomingMessages.length > 0) {
      for (const msg of missingIncomingMessages) {
        conversationMessages.push({
          role: 'user',
          content: msg.content
        });
      }
    }

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
    let tools = filteredUniqueTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));

    tools.map((tool) => {
      console.log(`Tool: ${tool.name}, Description: ${tool.description}`);
    })

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

For example, if you see I previously asked about hiking trails and you already fetched that information, don't fetch it again - just reference the existing results and continue the conversation.

Here's my current message: ${message.content}`;
    
    // Create initial message array
    let messageWithCurrentContent = [...cleanedMessages, { role: 'user' as const, content: enhancedPrompt }];
    
    // Check token count
    let tokenInfo = estimateTokenCount(messageWithCurrentContent, tools);
    console.log(`Initial estimated token count: ${tokenInfo.total} (Messages: ${tokenInfo.messageTokens}, Tools: ${tokenInfo.toolTokens})`);
    
    // If token count is too high, reduce the number of messages from oldest to newest
    if (tokenInfo.total > 30000) {
      console.log('Token count is high (>30k), reducing message history to fit within token limits');
      
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
    }
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
    

    // Process Claude's response
    for (const block of responseContent) {
      if (block.type === 'text') {
        finalResponse += block.text + '\n';
      } else if (block.type === 'tool_use') {
        // Ensure the block has a type field set to 'tool_use'
        block.type = 'tool_use'; // This ensures consistency even if the API changes
        toolCalls.push(block);
        
        try {
          // Execute tool call with caching and better error handling
          
          
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
              
              try {
                // Get available tools from MCP server
                const availableTools = await goGuideClient.getTools();
                
                // Find matching tool by name
                const matchingTool = availableTools.find(tool => 
                  tool.name.toLowerCase() === block.name.toLowerCase() || 
                  tool.name.replace(/\s+/g, '') === block.name.replace(/\s+/g, '')
                );
                
                if (matchingTool) {
                  
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
                console.error(`Retry also failed: ${retryError.message || 'Unknown error'}`);
                throw error;
              }
            } else {
              // Rethrow other errors
              throw error;
            }
          }
          
          // Format the tool result for better user experience
          const formattedResult = formatToolResponse(block.name, toolResult);
          

          // Update conversation history before creating the tool result message
          
          
          // Create a new message for the tool result
          // Keep status as 'pending' so it can be picked up for further processing
          // Store the raw tool result rather than the formatted text to ensure complete data
          const rawToolResultContent = typeof toolResult === 'string' 
            ? toolResult 
            : JSON.stringify(toolResult);
            
          const { data: toolResultMessage, error: toolResultError } = await supabase
            .from('conversation_messages')
            .insert({
              profile_id: message.profile_id,
              phone_number: message.phone_number,
              direction: 'outgoing',
              content: rawToolResultContent, // Use raw tool result instead of formatted text
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
          

          // Send immediate tool result via SMS
          if (formattedResult.text) {
            await supabase.functions.invoke('send-sms', {
              body: {
                to: message.phone_number,
                message: formattedResult.text
              }
            });
          }
          
          // For the next call, only include the specific tool that was just called
          // This drastically reduces context size when processing tool results
          
          // Find the specific tool definition
          const specificTool = tools.find(tool => tool.name === block.name);
          if (specificTool) {
            // Replace the full tools list with just this one tool
            tools = [specificTool];
          }
        } catch (error) {
          console.error('Error executing tool call:', error);
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          
          finalResponse += `Sorry, I encountered an error while trying to use one of my tools. ${errorMessage}\n`;
        }
      }
    }

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
      
      if (toolCalls.length > 0) {
      }
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