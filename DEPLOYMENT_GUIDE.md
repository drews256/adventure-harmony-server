# Deployment Guide

## Quick Fix for "Sending SMS to None" Error

The error occurs because the database migration hasn't been applied yet. The Python worker is looking for new columns (`from_number`, `to_number`, `conversation_id`) that don't exist.

### Option 1: Apply the Migration (Recommended)

```bash
# In your local development
supabase migration up

# Or push directly to production
supabase db push
```

This adds:
- `conversation_id` - Groups messages in conversations
- `from_number` / `to_number` - Clear SMS routing
- `metadata` - Flexible JSONB storage
- `thread_id` - Sub-conversation support

### Option 2: Deploy Without Migration (Temporary)

The updated Python worker now handles both schemas gracefully:
- Falls back to `phone_number` when `from_number`/`to_number` don't exist
- Uses parent chain traversal when `conversation_id` isn't available
- Only adds new columns to inserts if they exist in the database

## Environment Variables Required

Make sure these are set in your deployment:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ANTHROPIC_API_KEY=your-anthropic-key
```

## What the Worker Does

The A2A Python worker:
1. Polls for pending messages in `conversation_messages` table
2. Analyzes messages with Claude (no system prompt, matching original behavior)
3. Can execute tools (calendar, forms, help requests)
4. Sends appropriate responses
5. Maintains conversation history

## Key Fixes Applied

1. **Backward Compatibility**: Worker now handles both old schema (without new columns) and new schema
2. **Phone Number Handling**: Falls back to `phone_number` when `from_number`/`to_number` don't exist
3. **System Prompt**: Now includes the exact same system prompt as the TypeScript version
4. **All Tools Always Available**: Matches TypeScript - all tools are always provided to Claude (calendar, forms, help, SMS)
5. **Error Handling**: Uses `error_message` column when `metadata` doesn't exist
6. **Tool Choice Fix**: Only passes `tool_choice` parameter when tools are actually available
7. **SMS Sending**: Now actually sends SMS messages using `supabase.functions.invoke('send-sms', ...)`
8. **Error SMS**: Sends user-friendly error messages when processing fails
9. **Simplified Conversation History**: Retrieves all messages exchanged with a phone number, ordered by time
10. **Tool History**: Correctly formats tool_use and tool_result blocks in conversation history
11. **No Complex IDs**: Removed complex conversation_id/thread_id management - just uses phone number for continuity
12. **Tool Result Validation**: Ensures every tool_use block has a corresponding tool_result block (creates synthetic ones if missing)

## Tools Available

The Python worker now includes:

### Local Tools (always available):
- **calendar_display**: Calendar interface for scheduling
- **dynamic_form**: Form generation for user input
- **help_request**: Help request management
- **sms_send**: SMS message sending

### MCP Tools (when MCP server is available):
- All tools exposed by the MCP server are automatically available
- No filtering applied - the MCP server handles which tools to expose

## MCP Connection

The Python worker connects to the MCP server at the endpoint specified by:
```
MCP_ENDPOINT=http://localhost:3001/mcp/v1
```

On startup, it:
1. Connects to the MCP server
2. Retrieves all available tools
3. Makes them available to Claude alongside local tools

If MCP is not available, the worker continues with just local tools.

## System Prompt Context

The Python worker now uses the same system prompt as the TypeScript version, which:
- Emphasizes short, text-message-appropriate responses
- Sets context about working with an outfitter business
- Instructs not to refer to tools by name
- Tells Claude to reference all conversation history
- Prevents duplicate tool calls
- Instructs Claude to run tools immediately without asking permission