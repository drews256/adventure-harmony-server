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
   */
  async getTools(categories?: string[], profileId?: string): Promise<MCPTool[]> {
    console.log(`Getting tools with${profileId ? ' profile ID: ' + profileId : 'out profile ID'}`);
    if (categories && categories.length > 0) {
      console.log(`Filtering by categories: ${categories.join(', ')}`);
    }
    
    // Include profileId in the request to get profile-specific tools
    const listToolsOptions = profileId ? { profileId } : undefined;
    const toolsResult = await this.mcpClient.listTools(listToolsOptions);
    
    console.log(`MCP server returned ${toolsResult.tools.length} tools`);
    
    // Log a sample of tool names
    const sampleTools = toolsResult.tools.slice(0, 5).map((t: MCPTool) => t.name);
    console.log(`Sample tools from MCP: ${JSON.stringify(sampleTools)}`);
    
    if (!categories || categories.length === 0) {
      return toolsResult.tools;
    }
    
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
  }
  
  /**
   * Call a specific tool directly with simplified interface
   */
  async callTool(toolName: string, args: Record<string, unknown>, profileId?: string): Promise<any> {
    // Log the profile ID information
    if (profileId) {
      console.log(`Calling tool ${toolName} with profile ID: ${profileId}`);
    } else {
      console.log(`Calling tool ${toolName} without profile ID`);
    }
    
    // Get the tool by name - pass profileId when listing tools as well
    const toolsOptions = profileId ? { profileId } : undefined;
    const toolsResult = await this.mcpClient.listTools(toolsOptions);
    
    console.log(`Found ${toolsResult.tools.length} tools available`);
    
    const tool = toolsResult.tools.find((t: MCPTool) => t.name.includes(toolName));
    
    if (!tool) {
      console.error(`Tool not found: ${toolName}`);
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    // Include profileId in arguments if provided
    const argsWithProfile = profileId ? { ...args, profileId } : args;
    
    console.log(`Executing tool ${tool.name} (ID: ${tool.id || 'unknown'}) with profileId: ${profileId || 'none'}`);
    
    // Call the tool with provided arguments
    return this.mcpClient.callTool({
      id: tool.id || 'unknown',
      name: tool.name,
      arguments: argsWithProfile,
      tool_result: [] as any[]
    });
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