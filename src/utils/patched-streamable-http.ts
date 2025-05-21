/**
 * Patched StreamableHTTP transport that follows MCP specification
 * and resolves issues with the standard implementation
 * Based on: https://modelcontextprotocol.io/specification/
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isJSONRPCError, isJSONRPCRequest, isJSONRPCResponse, isJSONRPCNotification } from "@modelcontextprotocol/sdk/types.js";

/**
 * Extends the StreamableHTTPClientTransport to provide enhanced handling
 * of MCP protocol messages.
 * 
 * Key improvements:
 * 1. Tracks responses to prevent duplicates
 * 2. Properly handles notifications according to the spec
 * 3. Provides better error handling for common connection issues
 * 4. Fixes the initialize/initialized sequence
 */
export class PatchedStreamableHTTPClientTransport extends StreamableHTTPClientTransport {
  // Map to track requests that have been sent
  private readonly sentResponses = new Map<string | number, boolean>();
  
  // Track initialization status
  private initialized = false;
  private initializing = false;
  
  /**
   * Properly formatted MCP initialization message
   */
  private createInitializeMessage(id: number) {
    return {
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        // Client capabilities as per MCP spec
        capabilities: {
          textCompletion: true,
          toolCalls: true
        },
        // Client metadata
        clientInfo: {
          name: "GoGuide MCP Client",
          version: "1.0.0"
        },
        // Protocol version we support
        protocolVersion: "2025-03-26"
      }
    };
  }
  
  /**
   * Properly formatted initialized notification
   */
  private createInitializedNotification() {
    return {
      jsonrpc: "2.0", 
      method: "initialized",
      params: {}
    };
  }
  
  /**
   * Override send method to provide enhanced handling of MCP messages
   */
  async send(message: any, options?: any): Promise<void> {
    // Log concise message info for debugging
    const isRequest = isJSONRPCRequest(message);
    const isNotification = isJSONRPCNotification(message);
    
    console.log(`TRANSPORT: ${
      isRequest ? 'Request' : isNotification ? 'Notification' : 'Response'
    } - ${isRequest || isNotification ? 'Method: ' + message.method : 'ID: ' + message.id}`);
    
    // 1. SPECIAL HANDLING: INITIALIZE/INITIALIZED SEQUENCE
    
    // Properly handle initialization
    if (isRequest && message.method === 'initialize') {
      this.initializing = true;
      
      // Ensure the initialize message has the required params
      if (!message.params || !message.params.capabilities) {
        console.log('Enhanced initialize: Adding required capabilities to initialize message');
        
        // Create a proper initialize message
        const enhancedMessage = this.createInitializeMessage(message.id);
        // Call the original method with the enhanced message
        try {
          await super.send(enhancedMessage, options);
          
          // Set the initialized state for future reference
          this.initializing = false;
          this.initialized = true;
          
          // Send the initialized notification
          try {
            const initializedNotification = this.createInitializedNotification();
            await super.send(initializedNotification);
            console.log('Successfully sent initialized notification');
          } catch (notifyError) {
            console.log('Notification error (non-critical):', notifyError);
          }
          
          return;
        } catch (error) {
          this.initializing = false;
          throw error;
        }
      }
    }
    
    // Skip sending initialized notifications manually - we handle it after initialize
    if (isRequest && message.method === 'initialized') {
      console.log('Skipping manual initialized notification - handled automatically');
      return Promise.resolve();
    }
    
    // 2. DUPLICATE HANDLING
    
    // For responses, check if we've already sent a response for this ID
    if ((isJSONRPCResponse(message) || isJSONRPCError(message)) && message.id !== undefined) {
      const responseId = message.id;
      
      // Check if we've already responded to this request
      if (this.sentResponses.has(responseId)) {
        console.log(`Skipping duplicate response for request ID: ${responseId}`);
        return Promise.resolve();
      }
      
      // Mark this response as sent
      this.sentResponses.set(responseId, true);
    }
    
    // For requests, clear any previous response tracking
    if (isRequest && message.id !== undefined) {
      this.sentResponses.delete(message.id);
    }
    
    // 3. GRACEFUL ERROR HANDLING
    
    try {
      // Call the original send method
      return await super.send(message, options);
    } catch (error) {
      const errorStr = String(error);
      
      // Handle HTTP errors gracefully
      if (errorStr.includes('400 Bad Request') || 
          errorStr.includes('status code 400')) {
        
        // Log the issue
        console.warn(`HTTP 400 for ${isRequest ? message.method : 'response'}: ${errorStr}`);
        
        // We can safely ignore errors for notification methods
        if (isJSONRPCNotification(message)) {
          console.log(`Ignoring 400 error for notification: ${message.method}`);
          return Promise.resolve();
        }
        
        // For ping and similar utility methods, we can also safely ignore errors
        if (isRequest && ['ping', 'echo', 'health'].includes(message.method)) {
          console.log(`Ignoring 400 error for utility method: ${message.method}`);
          return Promise.resolve();
        }
      }
      
      // For connection errors, emit an event rather than throwing
      if (errorStr.includes('ECONNREFUSED') ||
          errorStr.includes('ECONNRESET') ||
          errorStr.includes('connection refused') ||
          errorStr.includes('socket hang up')) {
        
        console.error('Connection error detected:', errorStr);
        this.initialized = false;
        
        // Emit an error event instead of throwing
        this.onerror?.(new Error(`Connection error: ${errorStr}`));
        return Promise.resolve();
      }
      
      // Rethrow other errors
      throw error;
    }
  }
  
  /**
   * Override close to clean up resources
   */
  async close(): Promise<void> {
    this.sentResponses.clear();
    this.initialized = false;
    this.initializing = false;
    return super.close();
  }
  
  /**
   * Check if the connection is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Creates a patched StreamableHTTP transport
 * This function provides an easy way to create a patched transport with the same parameters
 * as the original StreamableHTTPClientTransport
 */
export function createPatchedStreamableHTTPTransport(url: URL, opts?: any): PatchedStreamableHTTPClientTransport {
  return new PatchedStreamableHTTPClientTransport(url, opts);
}