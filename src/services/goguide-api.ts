import { createClient } from '@supabase/supabase-js';

export interface MCPTool {
  name: string;
  description: string;
  id?: string;
  inputSchema?: any;
}

export interface MCPToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  tool_result: any[] | null;
}

export class GoGuideAPIClient {
  private supabase;
  private mcpClient;
  
  constructor(mcpClient: any, supabase: any) {
    this.mcpClient = mcpClient;
    this.supabase = supabase;
  }
  
  /**
   * Get available tools from MCP server, filtered by categories
   * 
   * Following MCP spec for tool listing with proper parameter passing
   */
  async getTools(categories?: string[], profileId?: string): Promise<MCPTool[]> {
    console.log(`Getting tools with${profileId ? ' profile ID: ' + profileId : 'out profile ID'}`);
    if (categories && categories.length > 0) {
      console.log(`Filtering by categories: ${categories.join(', ')}`);
    }
    
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        // Prepare options according to MCP spec
        // The profileId should be sent in a standard context parameter structure
        const listToolsOptions: any = {};
        
        // Add profileId directly as expected by MCP server (not wrapped in context)
        if (profileId) {
          listToolsOptions.profileId = profileId;
        }
        
        // Add category filtering if specified
        if (categories && categories.length > 0) {
          listToolsOptions.filter = {
            categories: categories
          };
        }
        
        // Make the request to list tools
        console.log(`Listing tools with options: ${JSON.stringify(listToolsOptions)}`);
        const toolsResult = await this.mcpClient.listTools(listToolsOptions);
        
        console.log(`MCP server returned ${toolsResult.tools.length} tools`);
        
        // Log a sample of tool names if available
        if (toolsResult.tools && toolsResult.tools.length > 0) {
          const sampleTools = toolsResult.tools.slice(0, 5).map((t: MCPTool) => t.name);
          console.log(`Sample tools from MCP: ${JSON.stringify(sampleTools)}`);
        } else {
          console.log(`No tools returned from MCP server`);
        }
        
        // If no categories specified or we already included category filtering in the request,
        // return all tools from the result
        if (!categories || categories.length === 0) {
          return toolsResult.tools;
        }
        
        // If server doesn't support category filtering, do it client-side
        // Filter tools by category
        const filteredTools = toolsResult.tools.filter((tool: MCPTool) => {
          // Check if the tool belongs to any of the requested categories
          return categories.some(category => 
            tool.name.toLowerCase().includes(category.toLowerCase()) ||
            tool.description.toLowerCase().includes(category.toLowerCase())
          );
        });
        
        console.log(`After category filtering: ${filteredTools.length} tools remain`);
        
        return filteredTools;
      } catch (error) {
        retryCount++;
        console.error(`Error getting tools (attempt ${retryCount}/${maxRetries}):`, error);
        
        // If this is the last retry, throw the error
        if (retryCount >= maxRetries) {
          console.error(`All ${maxRetries} attempts to get tools failed`);
          throw error;
        }
        
        // Otherwise wait before retrying
        const delay = 1000 * Math.pow(2, retryCount); // Exponential backoff
        console.log(`Waiting ${delay}ms before retry ${retryCount + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Check if it's a connection error
        const errorStr = String(error);
        if (errorStr.includes('Not connected') || 
            errorStr.includes('Connection error') ||
            errorStr.includes('stream is not readable') ||
            errorStr.includes('ECONNRESET') ||
            errorStr.includes('ECONNREFUSED') ||
            errorStr.includes('status code 400')) {
          console.log('Detected connection error, allowing reconnection to handle it...');
          
          // We'll let the built-in reconnection handle most issues
          // Only explicitly reset on critical failures
          if (errorStr.includes('Maximum reconnection attempts exceeded') ||
              errorStr.includes('Failed to reconnect')) {
            console.log('Critical connection failure, explicitly resetting connection...');
            
            // Try to reset the connection if available
            try {
              const workerModule = await import('../worker-entry');
              if (workerModule && typeof workerModule.resetMcpClient === 'function') {
                await workerModule.resetMcpClient();
                console.log('Connection reset successfully');
              }
            } catch (resetError) {
              console.error('Failed to reset connection:', resetError);
            }
          }
        }
      }
    }
    
    // This should never be reached due to the throw in the loop, but TypeScript needs it
    return [];
  }
  
  /**
   * Call a specific tool directly with simplified interface
   * 
   * Following MCP spec for tool calling with proper context parameter structure
   */
  async callTool(toolName: string, args: Record<string, unknown>, profileId?: string): Promise<any> {
    // Log the profile ID information
    if (profileId) {
      console.log(`Calling tool ${toolName} with profile ID: ${profileId}`);
    } else {
      console.log(`Calling tool ${toolName} without profile ID`);
    }
    
    let retryCount = 0;
    const maxRetries = 3;
    let tool: MCPTool | undefined;
    
    // First, try to get the tool with retries
    while (retryCount < maxRetries && !tool) {
      try {
        // Get the tool by name - pass profileId properly in context structure
        const toolsOptions: any = {};
        
        // Add profileId directly as expected by MCP server (not wrapped in context)
        if (profileId) {
          toolsOptions.profileId = profileId;
        }
        
        console.log(`Listing tools for tool lookup with options: ${JSON.stringify(toolsOptions)}`);
        const toolsResult = await this.mcpClient.listTools(toolsOptions);
        
        console.log(`Found ${toolsResult.tools.length} tools available`);
        
        tool = toolsResult.tools.find((t: MCPTool) => t.name.includes(toolName));
        
        if (!tool) {
          retryCount++;
          console.error(`Tool not found: ${toolName} (attempt ${retryCount}/${maxRetries})`);
          
          // If this is the last retry, throw an error
          if (retryCount >= maxRetries) {
            throw new Error(`Tool not found after ${maxRetries} attempts: ${toolName}`);
          }
          
          // Wait before retrying
          const delay = 1000 * Math.pow(2, retryCount); // Exponential backoff
          console.log(`Waiting ${delay}ms before tool lookup retry ${retryCount + 1}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        retryCount++;
        console.error(`Error listing tools for tool lookup (attempt ${retryCount}/${maxRetries}):`, error);
        
        // If this is the last retry, throw the error
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to list tools after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Wait before retrying
        const delay = 1000 * Math.pow(2, retryCount); // Exponential backoff
        console.log(`Waiting ${delay}ms before tool lookup retry ${retryCount + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Handle connection errors by letting built-in reconnection work
        const errorStr = String(error);
        if (errorStr.includes('Not connected') || 
            errorStr.includes('Connection error') ||
            errorStr.includes('stream is not readable') ||
            errorStr.includes('status code 400')) {
          console.log('Detected connection error during tool lookup, allowing reconnection...');
          
          // Only reset on critical failures
          if (errorStr.includes('Maximum reconnection attempts exceeded') ||
              errorStr.includes('Failed to reconnect')) {
            try {
              const workerModule = await import('../worker-entry');
              if (workerModule && typeof workerModule.resetMcpClient === 'function') {
                await workerModule.resetMcpClient();
                console.log('Connection reset successfully during tool lookup');
              }
            } catch (resetError) {
              console.error('Failed to reset connection during tool lookup:', resetError);
            }
          }
        }
      }
    }
    
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    // Prepare arguments according to MCP spec
    // Create a new object that follows the MCP specification
    const enhancedArgs: any = { ...args };
    
    // If profileId is provided, add it according to MCP server expectations
    // MCP server expects {profileId: someId} directly, not wrapped in context
    if (profileId) {
      // Check if there's already context provided in the arguments
      if (enhancedArgs.context && typeof enhancedArgs.context === 'object') {
        // We received {context: {profileId: someId}}, but MCP expects {profileId: someId}
        // Extract profileId from context if it exists there
        if (enhancedArgs.context.profileId) {
          enhancedArgs.profileId = enhancedArgs.context.profileId;
          delete enhancedArgs.context.profileId;
          // If context is now empty, remove it
          if (Object.keys(enhancedArgs.context).length === 0) {
            delete enhancedArgs.context;
          }
        } else {
          // Just add profileId directly at the top level
          enhancedArgs.profileId = profileId;
        }
      } else {
        // No context object, just add profileId directly
        enhancedArgs.profileId = profileId;
      }
    }
    
    console.log(`Executing tool ${tool.name} (ID: ${tool.id || 'unknown'}) with profile context: ${profileId || 'none'}`);
    
    // Reset retry counter for tool execution
    retryCount = 0;
    
    // Now try to call the tool with retries
    while (retryCount < maxRetries) {
      try {
        // Call the tool with structured arguments following MCP spec
        console.log(`Calling tool ${tool.name} (attempt ${retryCount + 1}/${maxRetries})...`);
        return await this.mcpClient.callTool({
          id: tool.id || undefined, // Use undefined instead of 'unknown'
          name: tool.name,
          arguments: enhancedArgs,
          tool_result: [] // Empty tool_result array as specified in MCP
        });
      } catch (error) {
        retryCount++;
        console.error(`Error calling tool ${tool.name} (attempt ${retryCount}/${maxRetries}):`, error);
        
        // If this is the last retry, throw the error
        if (retryCount >= maxRetries) {
          throw new Error(`Failed to call tool ${tool.name} after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Wait before retrying
        const delay = 1000 * Math.pow(2, retryCount); // Exponential backoff
        console.log(`Waiting ${delay}ms before tool call retry ${retryCount + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Handle connection errors
        const errorStr = String(error);
        if (errorStr.includes('Not connected') || 
            errorStr.includes('Connection error') ||
            errorStr.includes('stream is not readable') ||
            errorStr.includes('status code 400')) {
          console.log('Detected connection error during tool call, allowing reconnection...');
          
          // Only reset on critical failures
          if (errorStr.includes('Maximum reconnection attempts exceeded') ||
              errorStr.includes('Failed to reconnect')) {
            try {
              const workerModule = await import('../worker-entry');
              if (workerModule && typeof workerModule.resetMcpClient === 'function') {
                await workerModule.resetMcpClient();
                console.log('Connection reset successfully during tool call');
              }
            } catch (resetError) {
              console.error('Failed to reset connection during tool call:', resetError);
            }
          }
        }
      }
    }
    
    // This should never be reached due to the throw in the loop, but TypeScript needs it
    throw new Error(`Failed to call tool ${tool.name} after ${maxRetries} attempts`);
  }
  
  /**
   * Search for listings with simplified parameters
   */
  async searchListings(params: {
    location?: string;
    dateFrom?: string;
    dateTo?: string;
    guests?: number;
    profileId?: string;
    [key: string]: any;
  }): Promise<any> {
    const { profileId, ...otherParams } = params;
    return this.callTool('Listings_Search', {
      request: {
        location: params.location,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        guests: params.guests,
        ...otherParams
      }
    }, profileId);
  }
  
  /**
   * Check availability for a specific listing
   */
  async checkAvailability(listingId: string, dateFrom: string, dateTo: string, profileId?: string): Promise<any> {
    return this.callTool('Availability_SearchListingScheduleAvailability', {
      request: {
        listingId,
        dateFrom,
        dateTo
      }
    }, profileId);
  }
  
  /**
   * Get customer details
   */
  async getCustomer(customerId: string, profileId?: string): Promise<any> {
    return this.callTool('Customers_GetById', {
      customerId
    }, profileId);
  }
  
  /**
   * Search for customers
   */
  async searchCustomers(query: string, profileId?: string): Promise<any> {
    return this.callTool('Customers_Search', {
      request: {
        query
      }
    }, profileId);
  }
  
  /**
   * Get order details
   */
  async getOrder(orderId: string, profileId?: string): Promise<any> {
    return this.callTool('Orders_GetById', {
      orderId
    }, profileId);
  }
  
  /**
   * Search for orders
   */
  async searchOrders(params: {
    customerId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    profileId?: string;
    [key: string]: any;
  }): Promise<any> {
    const { profileId, ...requestParams } = params;
    return this.callTool('Orders_Search', {
      request: requestParams
    }, profileId);
  }
  
  /**
   * Get resource availability
   */
  async getResourceAvailability(
    resourceId: string, 
    dateFrom: string, 
    dateTo: string,
    profileId?: string
  ): Promise<any> {
    return this.callTool('Availability_SearchResourcesAvailability', {
      request: {
        resourceIds: [resourceId],
        dateFrom,
        dateTo
      }
    }, profileId);
  }
}

// Export client factory function
export function createGoGuideClient(mcpClient: any, supabase: any): GoGuideAPIClient {
  return new GoGuideAPIClient(mcpClient, supabase);
}