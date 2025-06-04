# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Message Analysis Server for the Adventure Harmony Planner application. It's a Node.js server that uses Claude AI to analyze incoming messages, process them with tools via the Model Context Protocol (MCP), and respond to users via SMS.

## Architecture

The system consists of two main components:

1. **Server** (`src/server.ts`): An Express server that exposes API endpoints for message analysis and health checks. It receives incoming messages and queues them for processing.

2. **Worker** (`python_worker_agno.py`): A Python background process that uses the Agno framework for agent orchestration. It picks up pending messages from the database, processes them with Agno agents (which use Claude), executes tool calls via MCP server integration, and sends responses back to users via SMS.

The application uses:
- **Agno**: A high-performance multi-agent framework for building agentic systems
- **MCP (Model Context Protocol)**: For tool execution and external system integration
- **Supabase**: For database storage
- **Anthropic API**: For Claude AI integration through Agno

## Database Structure

The primary tables include:
- `conversation_messages`: Stores all messages, their direction (incoming/outgoing), content, status, and relationships.
- `conversation_jobs`: Manages the processing queue for messages.

## Development Commands

```bash
# Install dependencies
npm install

# Install Python dependencies (for Python worker)
pip install -r requirements.txt

# Set up environment
cp .env.example .env

# Build TypeScript code
npm run build

# Run server in development mode (with hot reloading)
npm run dev

# Run only the server in development mode
npm run dev:server

# Run the Agno Python worker in development mode
npm run dev:agno-worker

# Run the A2A Python worker in development mode (legacy)
npm run dev:python-worker

# Start the server in production mode
npm start

# Start the Agno worker in production mode
npm run start:agno-worker

# Start the A2A Python worker in production mode (legacy)
npm run start:python-worker
```

## Environment Variables

Required environment variables:
- `PORT`: Server port (default: 3000)
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `ANTHROPIC_API_KEY`: Anthropic API key

## Deployment

The deployment uses the `Procfile.agno` to run both the web server and the Agno-based worker process:
- Web: `npm start` - Runs the Express server
- Worker: `python python_worker_agno.py` - Runs the Agno-based message processing worker