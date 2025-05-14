interface FormattedToolResponse {
  text: string;
  data: any;
}

/**
 * Format a tool response for user-friendly presentation
 */
export function formatToolResponse(toolName: string, result: any): FormattedToolResponse {
  // Base result
  const response: FormattedToolResponse = {
    text: '',
    data: result
  };
  
  try {
    // Format based on tool type
    if (toolName.includes('Listings_Search')) {
      const listings = Array.isArray(result) ? result : [];
      response.text = `Found ${listings.length} listings matching your criteria.`;
      
      if (listings.length > 0) {
        response.text += ' Here are some options:\n\n';
        listings.slice(0, 3).forEach((listing: any, index: number) => {
          response.text += `${index + 1}. ${listing.name || 'Listing'} - ${listing.priceFormatted || listing.price || 'Price unavailable'}\n`;
          
          if (listing.location) {
            response.text += `   Location: ${listing.location}\n`;
          }
          
          if (listing.description) {
            response.text += `   ${truncateText(listing.description, 100)}\n`;
          }
          
          response.text += '\n';
        });
      }
    } 
    else if (toolName.includes('Availability_')) {
      const availability = Array.isArray(result) ? result : [];
      response.text = `Checked availability for your dates. `;
      
      if (availability.length > 0) {
        const available = availability.filter((a: any) => a.isAvailable).length;
        response.text += `${available} out of ${availability.length} time slots are available.`;
      } else {
        response.text += `No availability information found.`;
      }
    }
    else if (toolName.includes('Customers_')) {
      if (Array.isArray(result)) {
        response.text = `Found ${result.length} customers.`;
        if (result.length > 0) {
          response.text += ' Here are the details:\n\n';
          result.slice(0, 3).forEach((customer: any, index: number) => {
            response.text += `${index + 1}. ${customer.firstName || ''} ${customer.lastName || ''}\n`;
            if (customer.email) response.text += `   Email: ${customer.email}\n`;
            if (customer.phone) response.text += `   Phone: ${customer.phone}\n`;
            response.text += '\n';
          });
        }
      } else if (result && typeof result === 'object') {
        response.text = `Customer information:`;
        if (result.firstName || result.lastName) {
          response.text += `\nName: ${result.firstName || ''} ${result.lastName || ''}`;
        }
        if (result.email) response.text += `\nEmail: ${result.email}`;
        if (result.phone) response.text += `\nPhone: ${result.phone}`;
      }
    }
    else if (toolName.includes('Orders_')) {
      if (Array.isArray(result)) {
        response.text = `Found ${result.length} orders.`;
        if (result.length > 0) {
          response.text += ' Here are the details:\n\n';
          result.slice(0, 3).forEach((order: any, index: number) => {
            response.text += `${index + 1}. Order #${order.orderNumber || order.id || 'Unknown'}\n`;
            if (order.status) response.text += `   Status: ${order.status}\n`;
            if (order.total) response.text += `   Total: ${order.total}\n`;
            if (order.createdAt) response.text += `   Date: ${formatDate(order.createdAt)}\n`;
            response.text += '\n';
          });
        }
      } else if (result && typeof result === 'object') {
        response.text = `Order information:`;
        if (result.orderNumber) response.text += `\nOrder #: ${result.orderNumber}`;
        if (result.status) response.text += `\nStatus: ${result.status}`;
        if (result.total) response.text += `\nTotal: ${result.total}`;
        if (result.createdAt) response.text += `\nDate: ${formatDate(result.createdAt)}`;
      }
    }
    else if (toolName.includes('Payment_')) {
      if (result && typeof result === 'object') {
        response.text = `Payment information:`;
        if (result.amount) response.text += `\nAmount: ${result.amount}`;
        if (result.status) response.text += `\nStatus: ${result.status}`;
        if (result.method) response.text += `\nMethod: ${result.method}`;
        if (result.date) response.text += `\nDate: ${formatDate(result.date)}`;
      } else {
        response.text = `Payment operation completed.`;
      }
    }
    else {
      // Try to auto-detect content type and format accordingly
      if (Array.isArray(result)) {
        response.text = `Found ${result.length} items.`;
      } else if (result && typeof result === 'object') {
        // Extract meaningful information from the object
        const importantKeys = Object.keys(result).filter(key => 
          !key.toLowerCase().includes('id') && 
          result[key] !== null && 
          result[key] !== undefined
        ).slice(0, 5);
        
        if (importantKeys.length > 0) {
          response.text = `Here's what I found:\n`;
          importantKeys.forEach(key => {
            const value = result[key];
            const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            
            if (typeof value === 'object') {
              response.text += `${formattedKey}: [Complex data]\n`;
            } else {
              response.text += `${formattedKey}: ${value}\n`;
            }
          });
        } else {
          response.text = `Request completed successfully.`;
        }
      } else {
        // For primitive results or undefined/null
        response.text = `Result: ${JSON.stringify(result)}`;
      }
    }
  } catch (error) {
    // Fallback if any formatting fails
    console.error('Error formatting tool response:', error);
    response.text = `Here's what I found: ${JSON.stringify(result).substring(0, 500)}`;
    if (JSON.stringify(result).length > 500) {
      response.text += '...';
    }
  }
  
  return response;
}

/**
 * Truncate text to a specific length
 */
function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Format a date string
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return dateString;
  }
}