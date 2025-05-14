import { cachedToolCall } from './cache';

interface PipelineStep {
  toolName: string;
  args: Record<string, unknown> | ((prevResults: any[]) => Record<string, unknown>);
  transform?: (result: any, prevResults: any[]) => any;
}

/**
 * Executes a pipeline of tool calls, with each step potentially using results from previous steps
 */
export async function executeToolPipeline(
  mcpClient: any,
  steps: PipelineStep[]
): Promise<any[]> {
  const results: any[] = [];
  
  for (const step of steps) {
    try {
      // Determine arguments - either static or dynamic based on previous results
      const args = typeof step.args === 'function' 
        ? step.args(results) 
        : step.args;
      
      // Execute tool call with caching
      const result = await cachedToolCall(
        step.toolName, 
        args, 
        () => mcpClient.callTool({
          name: step.toolName,
          arguments: args,
          tool_result: []
        })
      );
      
      // Transform result if needed
      const transformedResult = step.transform 
        ? step.transform(result, results) 
        : result;
      
      // Add to results
      results.push(transformedResult);
    } catch (error) {
      console.error(`Error in pipeline step ${step.toolName}:`, error);
      results.push({ error: error.message });
    }
  }
  
  return results;
}

/**
 * Common tool pipelines for frequent requests
 */
export const commonPipelines = {
  // Find availability for listings in a location
  findLocationAvailability: (location: string, dateFrom: string, dateTo: string) => [
    {
      toolName: 'Listings_Search',
      args: {
        request: {
          location,
          limit: 5
        }
      }
    },
    {
      toolName: 'Availability_SearchListingScheduleAvailability',
      args: (prevResults) => {
        const listings = prevResults[0] || [];
        const listingIds = listings.map((l: any) => l.id).filter(Boolean);
        return {
          request: {
            listingIds,
            dateFrom,
            dateTo
          }
        };
      }
    }
  ],
  
  // Get order details with customer information
  getOrderWithCustomer: (orderId: string) => [
    {
      toolName: 'Orders_GetById',
      args: { orderId }
    },
    {
      toolName: 'Customers_GetById',
      args: (prevResults) => {
        const order = prevResults[0] || {};
        return { customerId: order.customerId };
      }
    }
  ],
  
  // Get customer with their orders
  getCustomerWithOrders: (customerId: string) => [
    {
      toolName: 'Customers_GetById',
      args: { customerId }
    },
    {
      toolName: 'Orders_Search',
      args: (prevResults) => {
        const customer = prevResults[0] || {};
        return { 
          request: {
            customerId: customer.id,
            limit: 5
          }
        };
      }
    }
  ],
  
  // Search for resources and check their availability
  findResourceAvailability: (query: string, dateFrom: string, dateTo: string) => [
    {
      toolName: 'Resources_Search',
      args: {
        request: {
          query,
          limit: 5
        }
      }
    },
    {
      toolName: 'Availability_SearchResourcesAvailability',
      args: (prevResults) => {
        const resources = prevResults[0] || [];
        const resourceIds = resources.map((r: any) => r.id).filter(Boolean);
        return {
          request: {
            resourceIds,
            dateFrom,
            dateTo
          }
        };
      }
    }
  ]
};