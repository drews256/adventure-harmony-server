# A2A Protocol Implementation

This project implements Google's A2A (Application-to-Agent) protocol, enabling standardized agent communication and interoperability.

## Overview

The A2A implementation (`python_worker_a2a.py`) provides:

- **JSON-RPC 2.0 Communication**: Standard message format for agent interactions
- **Agent Discovery**: Agent Cards that describe capabilities and available tools
- **Tool Management**: Standardized tool definitions with input/output schemas
- **Protocol Compliance**: Full A2A protocol support for agent interoperability

## Architecture

### Key Components

1. **A2AMessage**: Implements JSON-RPC 2.0 message format
2. **A2AAgentCard**: Describes agent capabilities for discovery
3. **A2ATool**: Standardized tool definitions with schemas
4. **A2ALocalTool**: Base class for A2A-compliant tools
5. **A2AMessageProcessor**: Handles A2A requests and Claude integration

### Supported A2A Methods

- `agent.discover`: Returns the agent card with capabilities
- `tool.execute`: Executes a specific tool with parameters
- `message.process`: Processes messages using Claude AI

### Tools

All tools are A2A-compliant with proper schemas:

1. **calendar_display**: Calendar interface for date management
2. **dynamic_form**: Dynamic form generation for user input
3. **sms_send**: SMS message sending
4. **help_request**: Help request management

## Database Schema

The worker uses a simplified approach for conversation management:

- `phone_number` (TEXT): The primary identifier for conversations - all messages to/from a number form the conversation
- `direction` (TEXT): Whether the message is 'incoming' or 'outgoing'
- `parent_message_id` (UUID): Links a response to the message it's replying to
- `metadata` (JSONB): Optional - stores tool results and A2A protocol data
- `from_number` / `to_number` (TEXT): Optional - additional routing information
- `conversation_id` / `thread_id` (UUID): Optional - only used if explicitly set by the system

### Running the Migration

Before using the A2A worker, apply the database migration:

```bash
# Apply migration locally
supabase migration up

# Or run directly in production
supabase db push
```

## Usage

### Running the A2A Worker

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run the A2A worker
python python_worker_a2a.py

# Or use npm scripts
npm run dev:a2a-worker
npm run start:a2a-worker
```

### Environment Variables

Required environment variables in your `.env`:

```env
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=your-anthropic-key

# Optional
POLL_INTERVAL=5
A2A_AGENT_ID=message-analysis-agent
A2A_AGENT_NAME=Message Analysis Agent
```

### Setting Environment Variables for Deployment

**For Heroku:**
```bash
heroku config:set SUPABASE_URL="your_url"
heroku config:set SUPABASE_SERVICE_ROLE_KEY="your_key"  
heroku config:set ANTHROPIC_API_KEY="your_key"
```

**For Railway/Render:**
Add the environment variables in the dashboard settings.

## Example A2A Interactions

### Agent Discovery
```json
{
  "jsonrpc": "2.0",
  "id": "123",
  "method": "agent.discover"
}
```

### Tool Execution
```json
{
  "jsonrpc": "2.0",
  "id": "456",
  "method": "tool.execute",
  "params": {
    "tool": "calendar_display",
    "params": {
      "year": 2025,
      "month": 5
    },
    "context": {
      "conversation_id": "uuid-here"
    }
  }
}
```

### Message Processing
```json
{
  "jsonrpc": "2.0",
  "id": "789",
  "method": "message.process",
  "params": {
    "content": "I need help scheduling a meeting",
    "conversation_id": "uuid-here",
    "history": []
  }
}
```

## Benefits of A2A Protocol

1. **Interoperability**: Communicate with agents from different frameworks
2. **Standardization**: Consistent message formats and tool definitions
3. **Discovery**: Agents can discover each other's capabilities
4. **Flexibility**: Supports sync, streaming, and async communication
5. **Enterprise Ready**: Designed with security and scalability in mind

## Integration with Existing System

The A2A worker seamlessly integrates with your existing infrastructure:

- Uses the same `conversation_messages` table
- Retrieves conversation history by phone number - all messages to/from that number
- Stores A2A protocol data in the `metadata` JSONB column (if available)
- Tracks tool usage and results for debugging
- Sends SMS messages via Supabase Edge Function: `supabase.functions.invoke('send-sms', ...)`
- Sends error messages to users when processing fails

### Simplified Conversation Management

Instead of complex conversation_id and thread_id tracking, the worker simply:
1. Gets all previous messages exchanged with a phone number
2. Orders them by creation time
3. Formats them properly for Claude (including tool use/results)
4. Provides the full context of the SMS conversation

### SMS Sending

The worker uses the same Supabase Edge Function as the TypeScript version:

```python
supabase.functions.invoke(
    "send-sms",
    invoke_options={
        "body": {
            "to": phone_number,
            "message": text_content
        }
    }
)
```

### Error Handling

When errors occur, the worker:
1. Updates the message status to 'failed' with error details
2. Sends a user-friendly error message via SMS
3. Provides specific messages for common errors (rate limits, connection issues)

## Testing

Use the included test client to verify A2A functionality:

```bash
python test_a2a_client.py
```

This demonstrates all supported A2A methods and tool executions.