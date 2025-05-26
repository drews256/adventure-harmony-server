# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Message Analysis Server for the Adventure Harmony Planner application. It's a Node.js server that uses Claude AI to analyze incoming messages, process them with tools via the Model Context Protocol (MCP), and respond to users via SMS.

## Architecture

The system consists of two main components:

1. **Server** (`src/server.ts`): An Express server that exposes API endpoints for message analysis and health checks. It receives incoming messages and queues them for processing.

2. **Worker** (`python_worker_a2a.py`): A Python background process that picks up pending messages from the database, processes them with Claude, executes any tool calls, and sends responses back to users via SMS. This worker implements Google's A2A (Application-to-Agent) protocol for standardized agent communication and interoperability.

The application uses Supabase for database storage and the Anthropic API for Claude integration.

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

# Run server and TypeScript worker in development mode (with hot reloading)
npm run dev

# Run only the server in development mode
npm run dev:server

# Run only the TypeScript worker in development mode
npm run dev:worker

# Run the Python worker in development mode
npm run dev:python-worker
# or directly:
python python_worker.py

# Start the server in production mode
npm start

# Start the TypeScript worker in production mode
npm run start:worker

# Start the Python worker in production mode
npm run start:python-worker
# or directly:
python python_worker.py
```

## Environment Variables

Required environment variables:
- `PORT`: Server port (default: 3000)
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key
- `ANTHROPIC_API_KEY`: Anthropic API key

## Deployment

The deployment uses the `Procfile` to run both the web server and the worker process. The worker is implemented in Python using the A2A protocol.