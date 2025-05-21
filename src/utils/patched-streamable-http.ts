/**
 * Patched StreamableHTTP transport that fixes the issue with duplicate send calls
 * Based on the issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/451
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isJSONRPCError, isJSONRPCRequest, isJSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";

/**
 * Extends the StreamableHTTPClientTransport to fix the duplicate send issue.
 * This patched version tracks requests and responses to ensure each response is only sent once.
 * It also handles certain notification methods that might not be supported by all MCP servers.
 */
export class PatchedStreamableHTTPClientTransport extends StreamableHTTPClientTransport {
  // Map to track requests that have been sent
  private readonly sentResponses = new Map<string | number, boolean>();
  
  /**
   * Override the send method to prevent duplicate sends and handle unsupported methods
   */
  async send(message: any, options?: any): Promise<void> {
    // Log the message type and method for debugging
    console.log(`TRANSPORT SEND MESSAGE: ${JSON.stringify(message).substring(0, 200)}`);
    
    // Special case: Handle the notifications/initialized method gracefully
    // This method often returns a 400 Bad Request from some MCP servers
    if (isJSONRPCRequest(message) && 
        message.method === 'notifications/initialized') {
      console.log('Intercepting notifications/initialized method - this is often rejected by MCP servers');
      // Instead of sending the request, return a fake successful response
      return Promise.resolve();
    }
    
    // For responses and errors, check if we've already sent a response for this ID
    if ((isJSONRPCResponse(message) || isJSONRPCError(message)) && message.id !== undefined) {
      const responseId = message.id;
      
      // If we've already sent a response for this ID, skip it
      if (this.sentResponses.has(responseId)) {
        console.log(`Skipping duplicate response for request ID: ${responseId}`);
        return;
      }
      
      // Mark this response as sent
      this.sentResponses.set(responseId, true);
    }
    
    // For requests, clear the sent response tracking for the request ID
    if (isJSONRPCRequest(message) && message.id !== undefined) {
      this.sentResponses.delete(message.id);
    }
    
    try {
      // Call the original send method
      return await super.send(message, options);
    } catch (error) {
      // Special handling for 400 errors on specific methods
      const errorStr = String(error);
      if (errorStr.includes('400 Bad Request') || 
          errorStr.includes('status code 400')) {
        
        console.error(`Received 400 Bad Request for message: ${JSON.stringify(message).substring(0, 200)}`);
        
        // For notification methods (those without an ID), we can safely ignore the error
        if (isJSONRPCRequest(message) && message.id === undefined) {
          console.log(`Ignoring 400 error for notification method: ${message.method}`);
          return;
        }
        
        // For ping requests, we can also ignore errors as they're used for health checks
        if (isJSONRPCRequest(message) && message.method === 'ping') {
          console.log('Ignoring 400 error for ping method');
          return;
        }
      }
      
      // Rethrow for other cases
      throw error;
    }
  }
  
  /**
   * Override close to clear the sent responses map
   */
  async close(): Promise<void> {
    this.sentResponses.clear();
    return super.close();
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