# Booking Agent Integration Guide

## Overview

The Booking Agent is a specialized agent designed to handle booking creation and management through the MCP server. It addresses the challenge of the original agent not understanding how to create bookings by providing:

1. **Specialized Instructions**: Clear guidance on gathering required fields
2. **Multi-step Workflows**: Handles availability checking before booking
3. **Intelligent Field Collection**: Conversational approach to gather missing information
4. **Error Recovery**: Graceful handling of booking failures

## Architecture

### Agent Structure

```typescript
bookingAgent
├── Instructions: Detailed booking workflow guidance
├── Tools:
│   ├── check_availability
│   ├── create_booking
│   ├── update_booking
│   ├── get_booking_details
│   ├── list_products
│   ├── calculate_pricing
│   ├── send_sms
│   ├── create_form
│   └── create_form_and_send_link
└── Model: claude-3-haiku-20240307
```

### Integration Points

1. **Agent Selection** (`src/mastra/index.ts`):
   - Booking keywords trigger the booking agent
   - Keywords: book, booking, reserve, reservation, tour, activity, rental, ticket

2. **MCP Server Connection** (`src/mastra/tools/bookingTools.ts`):
   - Each tool creates its own MCP client connection
   - Uses patched StreamableHTTP transport for reliability
   - Connects to configured MCP_SERVER_URL

## Booking Workflow

### 1. Information Gathering
```
User: "I want to book a tour"
Agent: Identifies booking intent → Asks for date, party size, preferences
```

### 2. Product Selection
```
Agent: Lists available products → Helps user choose → Shows pricing
```

### 3. Availability Check
```
Agent: Checks availability → Suggests alternatives if needed
```

### 4. Booking Creation
```
Agent: Collects all fields → Creates booking → Provides confirmation
```

## Enhanced MCP Server Recommendations

To improve the booking experience, the MCP server should provide:

### 1. Better Tool Descriptions

```yaml
# Current (vague)
create_booking:
  description: "Create a booking"
  
# Recommended (detailed)
create_booking:
  description: "Create a new booking reservation"
  parameters:
    productId:
      required: true
      description: "Product/Service ID to book"
      example: "tour-123"
    customerId:
      required: true
      description: "Customer ID making the booking"
    date:
      required: true
      format: "YYYY-MM-DD"
      description: "Booking date"
```

### 2. Validation Messages

```javascript
// Add to MCP server responses
{
  "error": "MISSING_REQUIRED_FIELD",
  "field": "customerId",
  "message": "Customer ID is required for booking creation",
  "hint": "Use get_customer_by_phone to find customer ID"
}
```

### 3. Workflow Tools

Add tools that support the booking workflow:

```typescript
// New MCP tools to add
- get_customer_by_phone(phone: string): Customer
- check_product_requirements(productId: string): RequiredFields
- validate_booking_data(data: BookingRequest): ValidationResult
```

### 4. Response Enrichment

Include helpful context in responses:

```javascript
// Availability response
{
  "available": true,
  "slots": [...],
  "requiredFields": ["customerId", "partySize"],
  "priceRange": { "min": 50, "max": 150 },
  "bookingPolicy": "Cancellable up to 24 hours before"
}
```

## Usage Examples

### Basic Booking Flow

```typescript
// User message: "Book a kayak tour for 2 people tomorrow"

// Agent process:
1. Parse requirements: { type: "kayak tour", partySize: 2, date: "tomorrow" }
2. List kayak tours: await listProducts({ category: "kayak" })
3. Check availability: await checkAvailability({ productId, date, partySize })
4. Create form for missing info: await createForm({ fields: ["name", "phone", "email"] })
5. Create booking: await createBooking({ productId, customerId, date, partySize })
6. Send confirmation: await sendSMS({ to: customerPhone, message: confirmationDetails })
```

### Handling Missing Information

```typescript
// Agent detects missing customer ID
if (!customerId && customerPhone) {
  // Try to find existing customer
  const customer = await mcpClient.callTool('get_customer_by_phone', { phone });
  
  if (!customer) {
    // Create form to collect customer details
    const form = await createForm({
      title: "Complete Your Booking",
      fields: [
        { name: "firstName", label: "First Name", required: true },
        { name: "lastName", label: "Last Name", required: true },
        { name: "email", label: "Email", type: "email", required: true }
      ]
    });
    
    // Send form link
    await sendSMS({
      to: customerPhone,
      message: `Please complete your details to finish booking: ${form.url}`
    });
  }
}
```

## Testing the Booking Agent

### Test Scenarios

1. **Complete Information**:
   ```
   "Book tour-123 for john@example.com on 2024-03-15 for 2 people"
   ```

2. **Missing Information**:
   ```
   "I want to book a tour"
   → Agent should ask for details progressively
   ```

3. **Availability Issues**:
   ```
   "Book tour-456 for tomorrow"
   → If unavailable, agent suggests alternatives
   ```

4. **Error Handling**:
   ```
   Invalid product ID → Agent explains and helps find valid products
   ```

## Monitoring and Debugging

### Key Metrics

- Booking success rate
- Average fields collected before successful booking
- Most common missing fields
- Tool call failures

### Debug Logging

```typescript
// Enable debug logging
process.env.DEBUG_BOOKING_AGENT = 'true';

// Logs will show:
- Selected agent for message
- Tool calls made
- MCP server responses
- Field collection progress
```

## Future Enhancements

1. **Booking Templates**: Pre-filled forms for common booking types
2. **Multi-language Support**: Detect user language and respond accordingly
3. **Payment Integration**: Add payment collection to booking flow
4. **Reminder System**: Automated reminders for upcoming bookings
5. **Modification Workflow**: Easy rescheduling and cancellation

## Conclusion

The Booking Agent provides a specialized solution for handling complex booking workflows. By combining:
- Clear agent instructions
- Dedicated booking tools
- Intelligent field collection
- Enhanced MCP server integration

It creates a seamless booking experience that understands context, handles errors gracefully, and guides users through the complete booking process.