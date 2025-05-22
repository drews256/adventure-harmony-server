import { defineConfig } from 'mastra';

export default defineConfig({
  name: 'message-analysis-server',
  
  tools: {
    './src/tools': ['sms', 'form-generator', 'calendar']
  },
  
  agents: {
    './src/agents': ['message-processor']
  },
  
  workflows: {
    './src/workflows': ['form-creation', 'calendar-query', 'conversation']
  }
});