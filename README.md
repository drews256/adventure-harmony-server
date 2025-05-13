# Message Analysis Server

This is a Node.js server that handles message analysis using Claude AI. It's designed to work with the Adventure Harmony Planner application.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Fill in your environment variables in `.env`:
- `PORT`: The port number for the server (default: 3000)
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
- `ANTHROPIC_API_KEY`: Your Anthropic API key

4. Build the TypeScript code:
```bash
npm run build
```

## Development

Run the server in development mode with hot reloading:
```bash
npm run dev
```

## Production

Build and start the server for production:
```bash
npm run build
npm start
```

## API Endpoints

### POST /analyze-message

Analyzes a message using Claude AI and stores the results in the database.

Request body:
```json
{
  "messageId": "uuid",
  "profileId": "uuid",
  "requestText": "string"
}
```

Response:
```json
{
  "success": true,
  "response": "string"
}
```

### GET /health

Health check endpoint.

Response:
```json
{
  "status": "ok"
}
``` 