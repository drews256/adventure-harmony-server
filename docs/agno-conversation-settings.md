# Agno Conversation History Settings

This document explains the conversation history settings available in Agno and which ones we're using for the SMS agent.

## Current Settings (Enabled)

### `add_history_to_messages=True`
- **Purpose**: Automatically includes previous conversation history in the messages sent to the model
- **Why we use it**: Essential for maintaining context in SMS conversations where users expect the agent to remember previous messages
- **Default**: False

### `num_history_runs=5`
- **Purpose**: Specifies how many previous exchanges to include in the conversation history
- **Why we use it**: 5 exchanges (10 messages total) provides good context without overwhelming the model or hitting token limits
- **Default**: 3

### `storage=PostgresStorage`
- **Purpose**: Persists session data across agent restarts
- **Why we use it**: Allows conversation continuity even after server restarts or deployments
- **Configuration**: Uses profile_id as session_id for per-user persistence

### `session_id=profile_id`
- **Purpose**: Unique identifier for each user's conversation session
- **Why we use it**: Ensures each phone number/profile has its own conversation history

## Optional Settings (Currently Disabled)

### `search_previous_sessions_history=True`
- **Purpose**: Allows the agent to search through previous conversation sessions
- **When to enable**: If you want the agent to remember conversations from days/weeks ago
- **Consideration**: May increase response time and token usage

### `num_history_sessions=2`
- **Purpose**: Number of previous sessions to include when searching history
- **When to enable**: Along with `search_previous_sessions_history` for long-term memory

### `read_chat_history=True`
- **Purpose**: Provides a tool that allows the agent to read the entire chat history
- **When to enable**: If you want the agent to explicitly search for specific information in past conversations

### `add_state_in_messages=True`
- **Purpose**: Enables using session state variables in the agent's instructions
- **When to enable**: If you need to maintain specific state variables (like user preferences) that affect instructions

## How It Works

1. When a new message comes in, Agno automatically:
   - Loads the session from PostgresStorage using the profile_id
   - Retrieves the last 5 exchanges from the current session
   - Includes them in the context sent to Claude

2. After generating a response:
   - The new exchange is saved to the session
   - Session data is persisted to PostgreSQL

3. The conversation history is maintained per profile_id, ensuring each user has their own context.

## Troubleshooting

If conversation history isn't working:
1. Check that DATABASE_URL is properly configured
2. Verify the agent_sessions table exists in the database
3. Ensure profile_id is being passed correctly to the agent
4. Check logs for any storage-related errors