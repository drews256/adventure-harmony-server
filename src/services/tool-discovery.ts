import type { MCPTool } from './goguide-api';

/**
 * Analyzes a message to suggest relevant tools
 */
export function suggestToolsForMessage(message: string, availableTools: MCPTool[]): MCPTool[] {
  const normalizedMessage = message.toLowerCase();
  
  // Define keyword-to-tool mappings
  const keywordMappings: Record<string, string[]> = {
    // Availability-related keywords
    'available': ['Availability_'],
    'book': ['Orders_', 'Availability_'],
    'reservation': ['Orders_', 'Availability_'],
    'schedule': ['Schedules_', 'Availability_'],
    
    // Listing-related keywords
    'listing': ['Listings_'],
    'property': ['Listings_'],
    'accommodation': ['Listings_'],
    'place': ['Listings_'],
    'stay': ['Listings_'],
    
    // Customer-related keywords
    'customer': ['Customers_'],
    'profile': ['Customers_'],
    'account': ['Customers_'],
    
    // Order-related keywords
    'order': ['Orders_'],
    'booking': ['Orders_'],
    'booking_order': ['Orders_'],
    
    // Payment-related keywords
    'payment': ['Payment_'],
    'pay': ['Payment_'],
    'refund': ['Payment_'],
    
    // Form-related keywords
    'form': ['Forms_'],
    'survey': ['Forms_'],
    'feedback': ['Forms_'],
    
    // Dashboard-related keywords
    'dashboard': ['Dashboard_'],
    'stats': ['Dashboard_', 'Reports_'],
    
    // Report-related keywords
    'report': ['Reports_'],
    'analytics': ['Dashboard_', 'Reports_'],
    
    // Resources and schedules
    'resource': ['Resources_'],
    'equipment': ['Resources_'],
    'time_slot': ['Schedules_']
  };
  
  // Identify keywords in the message
  const matchedPrefixes = new Set<string>();
  
  Object.entries(keywordMappings).forEach(([keyword, toolPrefixes]) => {
    if (normalizedMessage.includes(keyword)) {
      toolPrefixes.forEach(prefix => matchedPrefixes.add(prefix));
    }
  });
  
  // If no matches, return empty array
  if (matchedPrefixes.size === 0) {
    return [];
  }
  
  // Filter tools based on matched prefixes
  const matchedTools = availableTools.filter(tool => {
    return Array.from(matchedPrefixes).some(prefix => 
      tool.name.startsWith(prefix));
  });
  
  // Ensure no duplicate tool names
  const toolMap = new Map();
  matchedTools.forEach(tool => {
    if (!toolMap.has(tool.name)) {
      toolMap.set(tool.name, tool);
    }
  });
  
  return Array.from(toolMap.values());
}

/**
 * Adds tool suggestions as context for Claude
 */
export function addToolSuggestionsToPrompt(message: string, availableTools: MCPTool[]): string {
  const suggestedTools = suggestToolsForMessage(message, availableTools);
  
  if (suggestedTools.length === 0) {
    return message;
  }
  
  // Add tool suggestions to the message
  const toolSuggestions = suggestedTools
    .map(tool => `${tool.name}: ${tool.description}`)
    .join('\n');
  
  return `${message}\n\nBased on your question, you may find these tools helpful:\n${toolSuggestions}`;
}