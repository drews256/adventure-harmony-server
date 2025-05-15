/**
 * Simplified tool handler for processing tool requests and results
 */

import { createClient } from '@supabase/supabase-js';

// Function to safely format tool responses for Claude API
export function formatToolResponsesForClaude(toolResponseData: any) {
  // Ensure the response can be safely included in the Claude API
  // This prevents empty text blocks which cause API errors
  
  // 1. For messages with tool_use blocks, ensure the text is not empty
  if (Array.isArray(toolResponseData)) {
    return toolResponseData.map(block => {
      // If it's a text block, ensure it has content
      if (block.type === 'text' && (!block.text || block.text.trim() === '')) {
        return { 
          ...block, 
          text: 'Processing request...' 
        };
      }
      
      // Return other blocks unchanged
      return block;
    });
  }
  
  // If it's a simple string, return it as is
  return toolResponseData;
}

// Function to build conversation history with proper Claude format for tools
export function buildConversationHistoryWithTools(messages: any[]) {
  // This function builds a conversation history with proper formatting
  // for tool_use and tool_result blocks in Claude's format
  
  // Start with an empty array for Claude-formatted messages
  const claudeMessages: any[] = [];
  
  // 1. Process text messages
  const textMessages = messages.filter(msg => 
    // Only include messages with string content
    typeof msg.content === 'string' && 
    msg.content.trim() !== ''
  );
  
  // Add regular text messages
  for (const msg of textMessages) {
    const role = msg.direction === 'incoming' ? 'user' : 'assistant';
    claudeMessages.push({
      role,
      content: msg.content
    });
  }
  
  // 2. Process tool interactions
  // Find messages with tool calls
  const toolCallMessages = messages.filter(msg => 
    msg.tool_calls && 
    Array.isArray(msg.tool_calls) && 
    msg.tool_calls.length > 0
  );
  
  // Process each tool call
  for (const toolCallMsg of toolCallMessages) {
    for (const toolCall of toolCallMsg.tool_calls) {
      // Skip if invalid tool call
      if (!toolCall.id || !toolCall.name) continue;
      
      // Find corresponding tool result
      const toolResult = messages.find(msg => 
        msg.tool_result_for === toolCall.id && 
        typeof msg.content === 'string'
      );
      
      // Create tool use message with non-empty text block
      const textContent = 
        (typeof toolCallMsg.content === 'string' && toolCallMsg.content.trim() !== '') 
          ? toolCallMsg.content 
          : `Using ${toolCall.name} tool`;
      
      // 1. Add assistant message with tool_use
      claudeMessages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: textContent },
          { 
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input || toolCall.arguments || {}
          }
        ]
      });
      
      // 2. Add user message with tool_result
      const resultContent = 
        (toolResult && typeof toolResult.content === 'string')
          ? toolResult.content
          : JSON.stringify({ status: 'success', result: 'Tool completed successfully' });
      
      claudeMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: resultContent
          }
        ]
      });
    }
  }
  
  // 3. Ensure messages are sorted chronologically (if timestamps are available)
  // This is a simplification - full implementation would need to sort by timestamp
  
  // 4. Remove duplicate messages
  const uniqueMessages = Array.from(
    new Map(claudeMessages.map(msg => [JSON.stringify(msg), msg])).values()
  );
  
  return uniqueMessages;
}

// Function to extract and process tool calls from Claude's response
export async function processToolCallsFromClaude(responseContent: any[], 
                                                supabase: any, 
                                                mcp: any, 
                                                message: any, 
                                                messageId: string) {
  let finalResponse = '';
  const toolCalls: any[] = [];
  const messages: any[] = [];
  
  // 1. Process text blocks
  const textBlocks = responseContent.filter(block => 
    block.type === 'text' && 
    block.text && 
    block.text.trim() !== ''
  );
  
  // Combine all text blocks into a single response
  if (textBlocks.length > 0) {
    finalResponse = textBlocks.map(block => block.text).join('\n');
  }
  
  // 2. Process tool_use blocks
  const toolUseBlocks = responseContent.filter(block => block.type === 'tool_use');
  
  // Execute each tool call
  for (const block of toolUseBlocks) {
    // Add to the list of tool calls
    toolCalls.push(block);
    
    try {
      // Execute the tool call
      const toolResult = await mcp.callTool({
        id: block.id,
        name: block.name,
        arguments: block.input,
        tool_result: []
      });
      
      // Format result for storage
      const resultContent = typeof toolResult === 'string' 
        ? toolResult 
        : JSON.stringify(toolResult);
      
      // Store the tool result in the database
      const { data: toolResultMessage, error: toolResultError } = await supabase
        .from('conversation_messages')
        .insert({
          profile_id: message.profile_id,
          phone_number: message.phone_number,
          direction: 'outgoing',
          content: resultContent,
          parent_message_id: messageId,
          tool_result_for: block.id,
          status: 'completed'
        })
        .select()
        .single();
      
      if (toolResultError) {
        throw new Error(`Failed to store tool result: ${toolResultError.message}`);
      }
      
      // Add the tool interaction to the conversation history
      const textForToolUse = finalResponse.trim() !== '' 
        ? finalResponse 
        : `Using ${block.name} tool`;
        
      // Add assistant message with tool_use
      messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: textForToolUse },
          { 
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input || {}
          }
        ]
      });
      
      // Add user message with tool_result
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultContent
          }
        ]
      });
      
      // Log the tool interaction
      console.log(`Processed tool: ${block.name}, ID: ${block.id}`);
      console.log(`Result: ${resultContent.length > 100 ? resultContent.substring(0, 100) + '...' : resultContent}`);
    } catch (error) {
      console.error(`Error executing tool ${block.name}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      finalResponse += `\nError using tool: ${errorMessage}`;
    }
  }
  
  // Add the final text response to the history
  if (finalResponse.trim()) {
    messages.push({
      role: 'assistant',
      content: finalResponse
    });
  }
  
  return {
    finalResponse,
    toolCalls,
    messages
  };
}