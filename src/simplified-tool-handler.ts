/**
 * Simplified tool handler for processing tool requests and results
 */

import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { formatToolResponse } from './services/response-formatter';
import { withRetry } from './utils/retry';
import { CalendarTool } from './services/calendar-tool';

/**
 * Filters tool schemas to include only necessary parameters
 * @param tools Array of tools to filter
 * @returns Filtered tools with simplified schemas
 */
export function filterToolParameters(tools: any[]): any[] {
  if (!tools || !Array.isArray(tools) || tools.length === 0) {
    return [];
  }
  
  return tools.map(tool => {
    // Create a copy of the tool
    const filteredTool: any = {
      name: tool.name,
      description: tool.description,
    };
    
    // Only include input_schema if it exists
    if (tool.input_schema) {
      // You can modify this logic to filter specific properties
      // from the input_schema based on your requirements
      
      // For example, to exclude certain properties:
      // const excludedProps = ['some_prop', 'another_prop'];
      // const filteredSchema = {...tool.input_schema};
      // if (filteredSchema.properties) {
      //   excludedProps.forEach(prop => {
      //     if (filteredSchema.properties[prop]) {
      //       delete filteredSchema.properties[prop];
      //     }
      //   });
      // }
      // filteredTool.input_schema = filteredSchema;
      
      // For now, we'll just pass the input_schema as is
      filteredTool.input_schema = tool.input_schema;
    }
    
    return filteredTool;
  });
}

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
  
  // Process each tool call message (grouping all tools from the same message)
  for (const toolCallMsg of toolCallMessages) {
    // Get all valid tool calls for this message
    const validToolCalls = toolCallMsg.tool_calls.filter((toolCall: any) => toolCall.id && toolCall.name);
    
    if (validToolCalls.length === 0) continue;
    
    // Create tool use message with non-empty text block
    const textContent = 
      (typeof toolCallMsg.content === 'string' && toolCallMsg.content.trim() !== '') 
        ? toolCallMsg.content 
        : `Using tools`;
      
    // Create array with all tool_use blocks for this message
    const toolUseContent = [
      { type: 'text', text: textContent }
    ];
    
    // Add all tool use blocks from this message
    for (const toolCall of validToolCalls) {
      // TS needs explicit type for tool use blocks
      const toolUseBlock: any = { 
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input || toolCall.arguments || {}
      };
      toolUseContent.push(toolUseBlock);
    }
    
    // 1. Add a single assistant message with all tool_use blocks
    claudeMessages.push({
      role: 'assistant',
      content: toolUseContent
    });
    
    // 2. Create tool_result blocks for all tools in this message
    const toolResultBlocks = [];
    
    for (const toolCall of validToolCalls) {
      // Find corresponding tool result
      const toolResult = messages.find(msg => 
        msg.tool_result_for === toolCall.id && 
        typeof msg.content === 'string'
      );
      
      // Add tool result block
      const resultContent = 
        (toolResult && typeof toolResult.content === 'string')
          ? toolResult.content
          : JSON.stringify({ status: 'success', result: 'Tool completed successfully' });
      
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolCall.id,
        content: resultContent
      });
    }
    
    // Add a single user message with all tool_result blocks
    claudeMessages.push({
      role: 'user',
      content: toolResultBlocks
    });
  }
  
  // 3. Ensure every tool_use has a corresponding tool_result in the next message
  console.log('Validating tool_use and tool_result pairing...');
  const validatedMessages = [];
  
  for (let i = 0; i < claudeMessages.length; i++) {
    const currentMsg = claudeMessages[i];
    validatedMessages.push(currentMsg);
    
    // Check if this is an assistant message with tool_use blocks
    if (currentMsg.role === 'assistant' && 
        Array.isArray(currentMsg.content) && 
        currentMsg.content.some((block: any) => block.type === 'tool_use')) {
      
      // Get all tool_use blocks in this message
      const toolUseBlocks = currentMsg.content.filter((block: any) => block.type === 'tool_use');
      
      // Check if the next message is a user message with matching tool_result blocks
      const hasMatchingResults = 
        (i + 1 < claudeMessages.length) && 
        claudeMessages[i + 1].role === 'user' &&
        Array.isArray(claudeMessages[i + 1].content) &&
        toolUseBlocks.every((toolUse: any) => {
          return claudeMessages[i + 1].content.some((block: any) => 
            block.type === 'tool_result' && 
            block.tool_use_id === toolUse.id
          );
        });
      
      // If not, insert a message with tool_result blocks
      if (!hasMatchingResults) {
        console.log(`Adding missing tool_result blocks for ${toolUseBlocks.length} tool_use blocks`);
        
        // Create a tool_result for each tool_use
        const toolResultBlocks = toolUseBlocks.map((toolUse: any) => ({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ status: 'success', result: 'Tool completed successfully' })
        }));
        
        // Insert a user message with the tool_result blocks
        validatedMessages.push({
          role: 'user',
          content: toolResultBlocks
        });
      }
    }
  }
  
  // 4. Remove duplicate messages
  const uniqueMessages = Array.from(
    new Map(validatedMessages.map(msg => [JSON.stringify(msg), msg])).values()
  );
  
  return uniqueMessages;
}

// These are already imported at the top of the file
// import { formatToolResponse } from './services/response-formatter';
// import { Anthropic } from '@anthropic-ai/sdk';

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
  
  // Only for tools, track both raw results (for Claude) and formatted results (for SMS)
  const toolResults: {
    id: string;
    name: string;
    result: any;
    formattedText: string;
    resultContent: string;
  }[] = [];
  
  // Execute each tool call
  for (const block of toolUseBlocks) {
    // Add to the list of tool calls
    toolCalls.push(block);
    
    try {
      // Execute the tool call with enhanced retry logic and better error handling
      let toolResult;
      
      // Check if this is a local tool call - handle locally
      if (block.name === 'Calendar_GenerateDisplay') {
        console.log('Handling calendar generation tool locally');
        const { CalendarTool } = await import('./services/calendar-tool');
        const calendarTool = new CalendarTool(supabase);
        toolResult = await calendarTool.createCalendar(block.input);
      } else if (block.name === 'Calendar_FormatEvents') {
        console.log('Handling event formatter tool locally');
        const { EventFormatter } = await import('./services/event-formatter');
        const eventFormatter = new EventFormatter();
        toolResult = await eventFormatter.formatEvents(block.input);
      } else if (block.name === 'HelpMe_CreateRequest') {
        console.log('Handling help request tool locally');
        const { HelpTool } = await import('./services/help-tool');
        const helpTool = new HelpTool(supabase);
        toolResult = await helpTool.createHelpRequest(block.input);
      } else if (block.name === 'FormGenerator_CreateForm') {
        console.log('Handling form generator tool locally');
        const { FormGenerator } = await import('./services/form-generator');
        const formGenerator = new FormGenerator(supabase);
        toolResult = await formGenerator.createForm(block.input);
      } else if (block.name === 'SMS_SendFormLink') {
        console.log('Handling SMS form link tool locally');
        const { SMSTool } = await import('./services/sms-tool');
        const smsTool = new SMSTool(supabase);
        toolResult = await smsTool.sendFormLink(
          block.input.phoneNumber,
          block.input.formUrl,
          block.input.formTitle,
          block.input.businessName
        );
      } else {
        // Use withRetry for more comprehensive retry handling with exponential backoff for MCP tools
        toolResult = await withRetry(
          async () => {
            try {
              // Process arguments to handle profile_id context mismatch
              const processedArgs = { ...block.input };
              
              // Extract profile_id if it's nested in context
              if (processedArgs.context && typeof processedArgs.context === 'object' && processedArgs.context.profileId) {
                processedArgs.profileId = processedArgs.context.profileId;
                delete processedArgs.context.profileId;
                // If context is now empty, remove it
                if (Object.keys(processedArgs.context).length === 0) {
                  delete processedArgs.context;
                }
              }
              
              return await mcp.callTool({
                id: block.id,
                name: block.name,
                arguments: processedArgs,
                tool_result: []
              });
            } catch (callError) {
              // Check if it's an SSE stream error
              const errorStr = String(callError);
              if (errorStr.includes("Server already initialized")) {
                console.log("Server reports it is already initialized, treating as successful");
                // Return a generic success response
                return { status: "success", result: "Tool execution completed successfully" };
              }
              
              if (
                errorStr.includes("stream is not readable") || 
                errorStr.includes("Error POSTing to endpoint") ||
                errorStr.includes("SSE")
              ) {
                console.error("SSE connection error, attempting to reconnect...");
                
                // Try to force a reconnect by resetting the MCP client
                try {
                  // Import the mcpClient reference from worker-entry.ts
                  const workerModule = await import('./worker-entry');
                  // Reset the client to force reconnection
                  if (workerModule && typeof workerModule.resetMcpClient === 'function') {
                    await workerModule.resetMcpClient();
                  }
                  
                  // Throw specific error to trigger retry
                  throw new Error("MCP connection reset, will retry");
                } catch (resetError) {
                  console.error("MCP reset failed:", resetError);
                  throw resetError;
                }
              }
              
              // For other types of errors, just rethrow
              throw callError;
            }
          },
          {
            maxRetries: 3,
            initialDelay: 1000,
            backoffFactor: 2,
            retryableErrors: [
              'stream is not readable', 
              'Error POSTing to endpoint', 
              'Connection timeout', 
              'MCP connection reset',
              'network error',
              'Server already initialized'
            ]
          }
        );
      }
      
      // Format result for storage
      const resultContent = typeof toolResult === 'string' 
        ? toolResult 
        : JSON.stringify(toolResult);
      
      // Create user-friendly formatted version of the tool result for SMS
      const formattedResult = formatToolResponse(block.name, toolResult);
      
      // Store both raw and formatted versions
      toolResults.push({
        id: block.id,
        name: block.name,
        result: toolResult,
        formattedText: formattedResult.text,
        resultContent
      });
      
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
  
  // 3. If tools were used, make a follow-up call to Claude with the tool results
  if (toolResults.length > 0) {
    try {
      console.log('Making follow-up call to Claude with tool results');
      
      // Create the anthropic client
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY || '',
      });
      
      // Build follow-up messages for Claude
      // Note: We're using the conversation history we've already built
      const followUpMessages = [];
      
      // Define specific types for content blocks to ensure they match Anthropic API
      type TextBlock = { type: 'text', text: string };
      type ToolUseBlock = { type: 'tool_use', id: string, name: string, input: any };
      
      // Add assistant message with initial response and tool use
      const initialToolUseBlocks: Array<TextBlock | ToolUseBlock> = [
        { type: 'text', text: finalResponse }
      ];
      
      // Add tool use blocks with the correct structure
      for (const block of toolUseBlocks) {
        initialToolUseBlocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input || {}
        } as ToolUseBlock);
      }
      
      followUpMessages.push({
        role: 'assistant',
        content: initialToolUseBlocks
      });
      
      // Add user message with tool results
      const toolResultBlocks = toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.id,
        content: tr.resultContent
      }));
      
      followUpMessages.push({
        role: 'user',
        content: toolResultBlocks
      });
      
      // Properly typed message arrays
      const typedFollowUpMessages: Array<{role: 'user' | 'assistant', content: any}> = [];

      // Process follow-up messages to ensure they conform to the Anthropic API
      for (const msg of followUpMessages) {
        // Ensure role is strictly 'user' or 'assistant' as a literal type
        const role: 'user' | 'assistant' = msg.role === 'user' ? 'user' : 'assistant';
        
        // If content is an array, ensure it follows ContentBlockParam format
        if (Array.isArray(msg.content)) {
          // Create a properly formatted content array
          const formattedContent = msg.content.map((block: any) => {
            if (block.type === 'text') {
              return { type: 'text' as const, text: block.text };
            } else if (block.type === 'tool_use') {
              return {
                type: 'tool_use' as const,
                name: block.name,
                input: block.input || {},
                id: block.id
              };
            } else if (block.type === 'tool_result') {
              return {
                type: 'tool_result' as const,
                tool_use_id: block.tool_use_id,
                content: block.content
              };
            }
            // Skip invalid blocks
            return null;
          }).filter(Boolean); // Remove any null values
          
          typedFollowUpMessages.push({ role, content: formattedContent });
        } else if (typeof msg.content === 'string') {
          // If content is a string, keep it as is
          typedFollowUpMessages.push({ role, content: msg.content });
        }
      }

      // Call Claude with follow-up
      const followUpResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        temperature: 0.7,
        messages: [
          ...typedFollowUpMessages,
          // Prompt Claude to summarize the tool results
          {
            role: 'user' as const,
            content: "Please analyze these tool results and give me a brief summary of what you found. Keep your response concise as it will be sent via SMS."
          }
        ]
      });
      
      // Extract text from follow-up response
      const followUpText = followUpResponse.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
      
      console.log('Follow-up response:', followUpText);
      
      // Combine original response with follow-up
      // Only update finalResponse for SMS, not for the conversation history
      finalResponse = `${finalResponse}\n\n${followUpText}`;
      
      // Add the follow-up response to messages
      messages.push({
        role: 'assistant',
        content: followUpText
      });
      
    } catch (error) {
      console.error('Error in follow-up Claude call:', error);
      
      // If follow-up fails, append formatted tool results directly
      const formattedToolResults = toolResults.map(tr => tr.formattedText).join('\n\n');
      finalResponse += `\n\nHere's what I found:\n${formattedToolResults}`;
    }
  }
  
  // Add the final text response to the history if not already added
  if (finalResponse.trim() && !messages.some(msg => 
    msg.role === 'assistant' && 
    !Array.isArray(msg.content) && 
    typeof msg.content === 'string')) {
    messages.push({
      role: 'assistant',
      content: finalResponse
    });
  }
  
  // Ensure all tool_use blocks have corresponding tool_result blocks
  const validatedMessages = [];
  
  for (let i = 0; i < messages.length; i++) {
    const currentMsg = messages[i];
    validatedMessages.push(currentMsg);
    
    // Check if this is an assistant message with tool_use blocks
    if (currentMsg.role === 'assistant' && 
        Array.isArray(currentMsg.content) && 
        currentMsg.content.some((block: any) => block.type === 'tool_use')) {
      
      // Get all tool_use blocks in this message
      const toolUseBlocks = currentMsg.content.filter((block: any) => block.type === 'tool_use');
      
      // Check if the next message is a user message with matching tool_result blocks
      const hasMatchingResults = 
        (i + 1 < messages.length) && 
        messages[i + 1].role === 'user' &&
        Array.isArray(messages[i + 1].content) &&
        toolUseBlocks.every((toolUse: any) => {
          return messages[i + 1].content.some((block: any) => 
            block.type === 'tool_result' && 
            block.tool_use_id === toolUse.id
          );
        });
      
      // If not, insert a message with tool_result blocks
      if (!hasMatchingResults) {
        console.log(`Adding missing tool_result blocks for ${toolUseBlocks.length} tool_use blocks`);
        
        // Create a tool_result for each tool_use
        const toolResultBlocks = toolUseBlocks.map((toolUse: any) => ({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ status: 'success', result: 'Tool completed successfully' })
        }));
        
        // Insert a user message with the tool_result blocks
        validatedMessages.push({
          role: 'user',
          content: toolResultBlocks
        });
      }
    }
  }
  
  return {
    finalResponse,
    toolCalls,
    messages: validatedMessages
  };
}