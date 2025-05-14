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
  async getTools(categories?: string[]): Promise<MCPTool[]> {
    const toolsResult = await this.mcpClient.listTools();
    
    if (!categories || categories.length === 0) {
      return toolsResult.tools;
    }
    
    // Filter tools by category
    return toolsResult.tools.filter((tool: MCPTool) => {
      // Check if the tool belongs to any of the requested categories
      return categories.some(category => 
        tool.name.toLowerCase().includes(category.toLowerCase()) ||
        tool.description.toLowerCase().includes(category.toLowerCase())
      );
    });
  }
  
  /**
   * Call a specific tool directly with simplified interface
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<any> {
    // Get the tool by name
    const toolsResult = await this.mcpClient.listTools();
    const tool = toolsResult.tools.find((t: MCPTool) => t.name.includes(toolName));
    
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    // Call the tool with provided arguments
    return this.mcpClient.callTool({
      id: tool.id || 'unknown',
      name: tool.name,
      arguments: args,
      tool_result: []
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
    [key: string]: any;
  }): Promise<any> {
    return this.callTool('Listings_Search', {
      request: {
        location: params.location,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        guests: params.guests,
        ...params
      }
    });
  }
  
  /**
   * Check availability for a specific listing
   */
  async checkAvailability(listingId: string, dateFrom: string, dateTo: string): Promise<any> {
    return this.callTool('Availability_SearchListingScheduleAvailability', {
      request: {
        listingId,
        dateFrom,
        dateTo
      }
    });
  }
  
  /**
   * Get customer details
   */
  async getCustomer(customerId: string): Promise<any> {
    return this.callTool('Customers_GetById', {
      customerId
    });
  }
  
  /**
   * Search for customers
   */
  async searchCustomers(query: string): Promise<any> {
    return this.callTool('Customers_Search', {
      request: {
        query
      }
    });
  }
  
  /**
   * Get order details
   */
  async getOrder(orderId: string): Promise<any> {
    return this.callTool('Orders_GetById', {
      orderId
    });
  }
  
  /**
   * Search for orders
   */
  async searchOrders(params: {
    customerId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    [key: string]: any;
  }): Promise<any> {
    return this.callTool('Orders_Search', {
      request: params
    });
  }
  
  /**
   * Get resource availability
   */
  async getResourceAvailability(
    resourceId: string, 
    dateFrom: string, 
    dateTo: string
  ): Promise<any> {
    return this.callTool('Availability_SearchResourcesAvailability', {
      request: {
        resourceIds: [resourceId],
        dateFrom,
        dateTo
      }
    });
  }
}

// Export client factory function
export function createGoGuideClient(mcpClient: any, supabase: any): GoGuideAPIClient {
  return new GoGuideAPIClient(mcpClient, supabase);
}