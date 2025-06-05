# MCP SSE Client Setup Guide

This document explains how to use the SSE-based MCP client implementation for connecting to the openapi-mcp-server.

## Overview

The message-analysis-server now includes a proper SSE (Server-Sent Events) based MCP client that can connect to the openapi-mcp-server. This replaces the previous attempt to use stdio-based transport with HTTP URLs.

## Key Changes

1. **New SSE-based MCP Client** (`src/agents/mcp_sse_client.py`)
   - Uses `httpx` and `httpx-sse` for SSE communication
   - Implements proper MCP protocol over SSE transport
   - Includes retry logic and error handling
   - Supports session management with session IDs

2. **Updated SMS Agent** (`src/agents/sms_agent.py`)
   - Now uses the SSE-based MCP client
   - Properly wraps MCP tools for Agno framework
   - Falls back gracefully if MCP is unavailable

3. **Simple SMS Agent Fallback** (`src/agents/sms_agent_simple.py`)
   - Provides a fallback agent that works without MCP
   - Uses direct Anthropic API calls
   - Automatically used if MCP connection fails

## Testing the Connection

### Prerequisites

1. Install required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

2. Start the openapi-mcp-server:
   ```bash
   cd ../openapi-mcp-server
   npm run dev
   ```

3. Ensure the server is running on port 3001 (default)

### Run the Test Script

```bash
python3 test_mcp_sse_connection.py
```

This will:
- Connect to the MCP server at http://localhost:3001
- Initialize the session using SSE
- List available tools
- Test a simple tool call if available

### Expected Output

When successful:
```
✅ Successfully connected to MCP server!
Connected: True
Session ID: <uuid>
Available tools: X
  - tool1: description
  - tool2: description
  ...
```

When the server is not running:
```
⚠️  Connection attempt 1 failed: All connection attempts failed
⏳ Retrying in 2 seconds...
⚠️  Connection attempt 2 failed: All connection attempts failed
⏳ Retrying in 2 seconds...
⚠️  Connection attempt 3 failed: All connection attempts failed
💥 All connection attempts failed. Is the MCP server running at http://localhost:3001?
❌ Connection test failed: Failed to connect to MCP server at http://localhost:3001 after 3 attempts
```

## Using with Agno Worker

The Agno worker (`python_worker_agno.py`) will automatically:
1. Try to connect to the MCP server with the SSE client
2. If successful, use the MCP-enabled SMS agent with tools
3. If failed, fall back to the simple SMS agent without tools

To run the Agno worker:
```bash
npm run dev:agno-worker
```

Or directly:
```bash
python python_worker_agno.py
```

## Configuration

Set the MCP server URL in your environment:
```bash
export MCP_SERVER_URL=http://localhost:3001
```

Or in your `.env` file:
```
MCP_SERVER_URL=http://localhost:3001
```

## Troubleshooting

1. **Connection Refused Error**
   - Ensure the openapi-mcp-server is running
   - Check the port number (default: 3001)
   - Verify no firewall is blocking the connection

2. **SSE Parse Errors**
   - Check the openapi-mcp-server logs for errors
   - Ensure the server is configured for SSE transport
   - Verify the `/mcp` endpoint is available

3. **Session Issues**
   - The client handles session IDs automatically
   - Sessions are tracked via `x-mcp-session-id` header
   - Check server logs for session-related errors

## Architecture Notes

The SSE client follows the MCP protocol specification:
1. Sends `initialize` request with capabilities
2. Receives `initialize` response with server info
3. Sends `initialized` notification
4. Can then call tools via `tools/call` method

All communication happens over SSE with proper event formatting and JSON-RPC 2.0 messages.