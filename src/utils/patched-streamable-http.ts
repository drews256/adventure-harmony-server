/**
 * Patched StreamableHTTP transport that fixes the issue with duplicate send calls
 * Based on the issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/451
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isJSONRPCError, isJSONRPCRequest, isJSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";

/**
 * Extends the StreamableHTTPClientTransport to fix the duplicate send issue.
 * This patched version tracks requests and responses to ensure each response is only sent once.
 */
export class PatchedStreamableHTTPClientTransport extends StreamableHTTPClientTransport {
  // Map to track requests that have been sent
  private readonly sentResponses = new Map<string | number, boolean>();
  
  /**
   * Override the send method to prevent duplicate sends
   */
  async send(message: any, options?: any): Promise<void> {
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
    
    // Call the original send method
    return super.send(message, options);
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