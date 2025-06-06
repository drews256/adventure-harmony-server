# SMS Message Processing Server

An AI-powered SMS processing server that uses Claude to understand and respond to incoming text messages. The server integrates with various tools and services through the Model Context Protocol (MCP) to provide automated assistance via SMS.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [Tools and Capabilities](#tools-and-capabilities)
- [Database Schema](#database-schema)
- [Worker Implementations](#worker-implementations)
- [Development Guide](#development-guide)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

This SMS Processing Server enables automated text message interactions by:
- Processing incoming SMS messages with AI-powered understanding
- Executing tools and integrations via Model Context Protocol (MCP)
- Managing conversations and message history
- Generating dynamic forms and calendar displays
- Integrating with external services and APIs

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   SMS Gateway   │────▶│  Express Server │────▶│    Supabase     │
│    (Twilio)     │     │   (server.ts)   │     │   PostgreSQL    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                │                         ▲
                                │                         │
                                ▼                         │
                        ┌─────────────────┐               │
                        │   Agno Worker    │───────────────┘
                        │  (Python/Agno)   │
                        └─────────────────┘
                                │
                                ▼
                        ┌─────────────────┐
                        │  Agno Framework  │
                        │   + Claude API   │
                        │   + MCP Tools    │
                        └─────────────────┘
```

### Components

1. **Express Server** (`src/server.ts`): 
   - HTTP API server handling incoming requests
   - Routes messages to processing queue
   - Serves calendars, forms, and other content

2. **Workers**: Background processors that handle message analysis
   - **Agno Worker** (`python_worker_agno.py`): High-performance agent using Agno framework (recommended)
   - **Python A2A Worker** (`python_worker_a2a.py`): Google A2A protocol implementation (legacy)

3. **Database** (Supabase/PostgreSQL):
   - Stores conversations, messages, forms, calendars
   - Manages job queue for message processing

4. **AI System**:
   - **Agno Framework**: Multi-agent orchestration with memory and reasoning
   - **Claude 3.5 Sonnet**: Natural language understanding via Agno
   - **MCP Integration**: Tool execution through Model Context Protocol
   - **Context Management**: Intelligent conversation history handling

## Key Features

- **Natural Language Processing**: Understands complex booking requests, questions, and commands
- **Contextual Conversations**: Maintains conversation history per phone number
- **Tool Integration**: Executes tools for bookings, calendars, forms, and more via MCP
- **Multi-Agent Support**: Agno framework enables sophisticated agent orchestration
- **Session Persistence**: PostgreSQL-based session storage for agent memory across conversations
- **URL Knowledge**: Integrated OCTO API documentation for travel/tourism domain expertise
- **Error Recovery**: Graceful handling of failures with user-friendly messages
- **Rate Limit Management**: Smart conversation history trimming
- **Flexible Form System**: Dynamic form generation based on JSON schemas
- **Calendar Management**: Visual calendar displays with event details

## Prerequisites

- Node.js 18+ and npm
- Python 3.9+ and pip
- Supabase account with database
- Anthropic API key (for Claude)
- (Optional) MCP server for external tools
- (Optional) Twilio account for SMS

## Installation

1. **Clone the repository**:
```bash
git clone <repository-url>
cd message-analysis-server
```

2. **Install Node.js dependencies**:
```bash
npm install
```

3. **Install Python dependencies**:
```bash
pip install -r requirements.txt
```

4. **Copy environment variables**:
```bash
cp .env.example .env
```

5. **Build the TypeScript code**:
```bash
npm run build
```

## Configuration

Create a `.env` file with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Anthropic Configuration
ANTHROPIC_API_KEY=your-anthropic-api-key

# Database Configuration for Agno Session Storage
# Uses Supabase Postgres with connection pooler
# Password special characters must be URL-encoded (& becomes %26, etc.)
DATABASE_URL=postgresql+psycopg://postgres.project_id:password@aws-0-region.pooler.supabase.com:5432/postgres

# Optional: MCP Configuration
MCP_SERVER_URL=http://localhost:3001
MCP_SERVER_NAME=example-server

# Optional: SMS Configuration (handled by Supabase functions)
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_PHONE_NUMBER=+1234567890
```

## Running the Application

### Development Mode

**Option 1: Run server only**:
```bash
npm run dev
```
This starts the server. You'll need to run a worker separately.

**Option 2: Run with Agno worker (recommended)**:
```bash
# Terminal 1: Start the server
npm run dev:server

# Terminal 2: Start the Agno worker
npm run dev:agno-worker
```

**Option 3: Run with A2A worker (legacy)**:
```bash
# Terminal 1: Start the server
npm run dev:server

# Terminal 2: Start the Python A2A worker
npm run dev:python-worker
```

### Production Mode

**Using the Agno Procfile**:
```bash
# This runs both server and Agno worker
heroku local -f Procfile.agno
```

**Or run separately**:
```bash
# Terminal 1: Server
npm start

# Terminal 2: Worker (choose one)
npm run start:agno-worker      # Agno worker (recommended)
npm run start:python-worker    # Python A2A worker (legacy)
```

## API Endpoints

### Core Endpoints

- **POST `/analyze-message`**: Process an incoming SMS message
  ```json
  {
    "message": "Check availability for tomorrow",
    "from": "+1234567890",
    "profileId": "user-uuid"
  }
  ```

- **GET `/health`**: Health check endpoint
  ```json
  {
    "status": "ok",
    "timestamp": "2024-01-15T10:00:00Z"
  }
  ```

### Calendar Endpoints

- **GET `/calendar/:id`**: Get calendar display
- **POST `/calendar`**: Create/update calendar display
- **GET `/calendar-iframe/:id`**: Embeddable calendar view

### Form Endpoints

- **GET `/form/:id`**: Get form definition
- **POST `/form/:id/submit`**: Submit form data
- **GET `/form-iframe/:id`**: Embeddable form view

### Help Request Endpoints

- **GET `/help/:id`**: Get help request details
- **POST `/help/:id/response`**: Submit help response

## Tools and Capabilities

### Local Tools

1. **Calendar Tool** (`calendar-tool.ts`):
   - Display booking calendars
   - Show availability
   - Manage events

2. **SMS Tool** (`sms-tool.ts`):
   - Send SMS notifications
   - Format messages

3. **Form Generator** (`form-generator.ts`):
   - Create dynamic forms
   - Handle submissions

4. **Help Tool** (`help-tool.ts`):
   - Create help requests
   - Track responses

### MCP Tools (when connected)

- OrderLine integration (bookings, availability)
- Token generation for secure access
- External API integrations

### Agno Framework Features

The Agno worker provides advanced capabilities:
- **Multi-agent orchestration**: Coordinate multiple specialized agents
- **Built-in memory**: Persistent context across conversations
- **Advanced reasoning**: Chain-of-thought processing
- **High performance**: ~3μs agent instantiation
- **Native multi-modal support**: Text, image, audio, video processing

## Database Schema

### Main Tables

1. **conversation_messages**:
   - `id`: UUID primary key
   - `direction`: 'incoming' or 'outgoing'
   - `content`: Message text
   - `from_phone`, `to_phone`: Phone numbers
   - `status`: Message processing status
   - `metadata`: JSONB for additional data

2. **conversation_jobs**:
   - `id`: UUID primary key
   - `message_id`: Reference to message
   - `status`: Job processing status
   - `attempts`: Retry counter

3. **calendar_displays**:
   - `id`: UUID primary key
   - `calendar_data`: JSONB calendar definition
   - `profile_id`: Owner reference

4. **dynamic_forms**:
   - `id`: UUID primary key
   - `schema`: JSON Schema definition
   - `ui_schema`: UI customization
   - `form_data`: Submitted data

See `supabase/migrations/` for complete schema definitions.

## Worker Implementations

### Agno Worker (Recommended)

Located at `python_worker_agno.py`, this worker:
- Uses Agno framework for multi-agent orchestration
- Integrates with MCP for tool execution
- Provides memory and reasoning capabilities
- High-performance agent instantiation (~3μs)
- Best for production use

### Python A2A Worker (Legacy)

Located at `python_worker_a2a.py`, this worker:
- Implements Google's A2A protocol
- Token-based conversation management
- Supports all local tools
- Good for A2A protocol compatibility


## Development Guide

### Project Structure

```
├── src/
│   ├── server.ts           # Main Express server
│   ├── agents/             # Agent implementations
│   │   ├── sms_agent.py    # Agno SMS agent
│   │   └── morning_update.py
│   ├── services/           # Core services
│   │   ├── calendar-tool.ts
│   │   ├── sms-tool.ts
│   │   ├── form-generator.ts
│   │   └── ...
│   ├── components/        # React components
│   └── types.ts           # TypeScript definitions
├── python_worker_agno.py  # Agno-based worker (recommended)
├── python_worker_a2a.py   # Python A2A worker (legacy)
├── supabase/
│   └── migrations/        # Database migrations
├── tests/                 # Test files
└── dist/                  # Compiled JavaScript
```

### Adding New Tools

1. Create tool in `src/services/`
2. Register in `tool-discovery.ts`
3. Add tool schema for AI understanding
4. Update worker to handle new tool

### Database Migrations

Create new migrations in `supabase/migrations/`:
```sql
-- Example: 20240115000000_add_new_table.sql
CREATE TABLE new_feature (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ...
);
```

## Testing

Run the test suite:
```bash
npm test
```

Run specific tests:
```bash
npm test -- --testNamePattern="SMS tool"
```

Test categories:
- Unit tests: Individual service testing
- Integration tests: API endpoint testing
- E2E tests: Full workflow testing

## Deployment

### Heroku

1. Create Heroku app:
```bash
heroku create your-app-name
```

2. Set environment variables:
```bash
heroku config:set ANTHROPIC_API_KEY=your-key
heroku config:set SUPABASE_URL=your-url
# ... set all required variables
```

3. Deploy:
```bash
git push heroku main
```

4. Scale workers:
```bash
heroku ps:scale web=1 worker=1
```

### Railway/Render

1. Connect GitHub repository
2. Set environment variables in dashboard
3. Deploy using `Procfile.unified`

### Docker (Alternative)

```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

## Troubleshooting

### Common Issues

1. **Worker not processing messages**:
   - Check database connection
   - Verify job queue status
   - Check worker logs for errors

2. **Claude API errors**:
   - Verify API key is valid
   - Check rate limits
   - Review conversation token usage

3. **Tool execution failures**:
   - Verify MCP server is running (if using)
   - Check tool permissions
   - Review tool implementation

4. **SMS not sending**:
   - Verify Supabase Edge Function is deployed
   - Check Twilio credentials
   - Review SMS logs in Supabase

### Debug Mode

Enable detailed logging:
```bash
DEBUG=* npm run dev
```

### Database Queries

Check pending messages:
```sql
SELECT * FROM conversation_messages 
WHERE status = 'pending' 
ORDER BY created_at DESC;
```

Check job queue:
```sql
SELECT * FROM conversation_jobs 
WHERE status IN ('pending', 'processing')
ORDER BY created_at DESC;
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push branch: `git push origin feature/new-feature`
5. Submit pull request

## License

[Your License Here]

## Support

For issues and questions:
- GitHub Issues: [repository-issues-url]
- Documentation: See `/docs` directory
- Email: support@adventureharmony.com