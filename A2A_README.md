# A2A Protocol Implementation

This project now includes support for Google's A2A (Application-to-Agent) protocol, enabling standardized agent communication and interoperability.

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

Add these A2A-specific variables to your `.env`:

```env
A2A_AGENT_ID=message-analysis-agent
A2A_AGENT_NAME=Message Analysis Agent
```

### Example A2A Request

```json
{
  "jsonrpc": "2.0",
  "id": "123",
  "method": "agent.discover"
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": "123",
  "result": {
    "agent_id": "message-analysis-agent",
    "name": "Message Analysis Agent",
    "version": "1.0.0",
    "description": "AI agent for message analysis and task execution",
    "tools": [...],
    "interaction_modes": ["synchronous", "streaming"]
  }
}
```

### Tool Execution Example

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
      "conversation_id": "conv-123"
    }
  }
}
```

## Benefits of A2A Protocol

1. **Interoperability**: Agents from different frameworks can communicate
2. **Standardization**: Consistent message formats and tool definitions
3. **Discovery**: Agents can discover each other's capabilities
4. **Security**: Designed with enterprise-grade security in mind
5. **Flexibility**: Supports sync, streaming, and async communication

## Integration with Existing System

The A2A worker maintains compatibility with the existing database schema and message flow:

- Polls the same `conversation_messages` table
- Processes messages with Claude AI
- Executes tools and saves results
- Sends SMS responses

The main difference is that all communication follows the A2A protocol standard, making the agent interoperable with other A2A-compliant systems.

## Future Enhancements

- Add support for agent-to-agent communication
- Implement streaming responses
- Add async push notifications
- Enable dynamic skill querying
- Support for external A2A agents

## Deployment

The application is configured to use the A2A Python worker by default. The `Procfile` specifies:

```
web: npm start
worker: python python_worker_a2a.py
```

Make sure your deployment platform has Python installed and installs dependencies from `requirements.txt`.