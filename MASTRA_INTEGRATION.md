# Mastra AI Agent Framework Integration

This document explains how to use the new Mastra AI agent framework integration in your message analysis server.

## Overview

Mastra is a TypeScript AI agent framework that provides structured tool orchestration and multi-agent coordination. We've integrated it to improve tool coordination and workflow management.

## Architecture

### Agents
We have 4 specialized agents:

1. **MessageProcessor** - Main agent for general message processing
2. **FormManager** - Specialized in form creation and management  
3. **CommunicationManager** - Handles SMS communications
4. **SchedulingAssistant** - Manages calendar displays and scheduling

### Tools
Each agent has access to these tools:

1. **send_sms** - Send SMS messages with validation
2. **create_form** - Create dynamic forms for data collection
3. **create_calendar_display** - Create mobile-optimized calendar displays
4. **create_form_and_send_link** - Combined form creation + SMS workflow

## Usage

### Basic Message Processing

```typescript
import { processMastraMessage } from './mastra-worker-integration';

// Process a conversation message
const message = {
  id: 'msg_123',
  content: 'I need to create a booking form',
  phone_number: '+1234567890',
  profile_id: 'profile_123',
  direction: 'incoming',
  status: 'pending'
};

const result = await processMastraMessage(message);
console.log(result); // { success: true, response: "...", actions: [...] }
```

### Form Creation Workflow

```typescript
import { createMastraForm } from './mastra-worker-integration';

const formResult = await createMastraForm(
  {
    title: "Customer Feedback",
    type: "feedback", 
    fields: [
      { name: "name", label: "Your Name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "rating", label: "Rating", type: "select", options: ["1","2","3","4","5"] }
    ]
  },
  "+1234567890", // customer phone
  "profile_123",  // business profile
  "Adventure Harmony" // business name
);
```

### Integration with Existing Worker

```typescript
import { processMessageWithFallback, isMastraReady } from './mastra-worker-integration';

// Use in your existing worker loop
async function processMessage(message) {
  if (isMastraReady()) {
    // Try Mastra first, fall back to existing system if needed
    const result = await processMessageWithFallback(message);
    console.log(`Processed with ${result.usedMastra ? 'Mastra' : 'fallback'}`);
    return result;
  } else {
    // Use existing system
    return await existingMessageProcessor(message);
  }
}
```

## Agent Selection Logic

Messages are automatically routed to the best agent:

- **Form keywords** → FormManager
- **SMS/communication keywords** → CommunicationManager  
- **Calendar/scheduling keywords** → SchedulingAssistant
- **Everything else** → MessageProcessor

## Environment Setup

Ensure these environment variables are set:

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## Health Checks

```typescript
import { getMastraStatus } from './mastra-worker-integration';

const status = getMastraStatus();
console.log(status);
// {
//   ready: true,
//   agents: 4,
//   tools: 4, 
//   issues: []
// }
```

## Error Handling

The integration includes automatic fallback:

1. **First**: Try Mastra agent processing
2. **Fallback**: Use existing message processing system
3. **Result**: Always returns a response, never fails completely

## Benefits

### vs. Previous System
- **Better tool coordination** - Agents manage complex workflows
- **Type safety** - Zod schemas ensure data validation
- **Scalability** - Easy to add new agents and tools
- **Observability** - Built-in tracing and error handling
- **Flexibility** - Agents can be specialized for different tasks

### Suspend/Resume Capabilities
- Agents can pause workflows when waiting for user input
- Context is preserved across message exchanges
- Perfect for SMS conversations with delays

## Development Commands

```bash
# Build with Mastra integration
npm run build

# Run with Mastra-enabled worker
npm run dev

# Test Mastra status
node -e "console.log(require('./dist/mastra-worker-integration').getMastraStatus())"
```

## Next Steps

1. **Test the integration** with real messages
2. **Monitor agent performance** using the status checks
3. **Customize agents** by modifying their instructions
4. **Add new tools** following the existing patterns
5. **Implement suspend/resume** for complex workflows

## Files Structure

```
src/mastra/
├── tools.ts           # Tool definitions with Zod schemas
├── agents.ts          # Agent configurations and instructions  
├── index.ts           # Main Mastra instance and workflows
└── ...

src/mastra-worker-integration.ts  # Integration with existing worker
```

The integration is designed to be a drop-in enhancement that improves your existing message processing while maintaining backward compatibility.