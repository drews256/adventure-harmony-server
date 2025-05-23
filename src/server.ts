import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Anthropic } from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// Import new service modules
import { createGoGuideClient } from './services/goguide-api';
import { withRetry } from './utils/retry';
import { CalendarTool } from './services/calendar-tool';

dotenv.config();

// Define the type for message roles
type MessageRole = 'user' | 'assistant';

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase client
const SUPABASE_URL = "https://dhelbmzzhobadauctczs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Initialize calendar tool
const calendarTool = new CalendarTool(supabase);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

let mcpClient: Client | null = null;

async function ensureMcpConnection() {
  try {
    if (!mcpClient) {
      const clientId = `mcp-client-cli-${Date.now()}`;
      console.log(`Creating new MCP client: ${clientId}`);
      
      mcpClient = new Client({ name: clientId, version: "1.0.0" });
      
      // Use StreamableHTTP transport instead of SSE for more reliability
      // Log the transport creation
      console.log("Creating MCP client transport");
      
      // Important: Use /mcp endpoint for proper StreamableHTTP transport
      const transportUrl = new URL("https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com/mcp");
      console.log(`Using transport URL: ${transportUrl.toString()}`);
      
      const transport = new SSEClientTransport(transportUrl);
      
      // Log transport details
      console.log(`Transport created: ${transport.constructor.name}`);
      
      console.log('Starting new MCP connection with SSE transport');
      
      await mcpClient.connect(transport);
      console.log('MCP client connected successfully');
    }
    
    return mcpClient;
  } catch (error) {
    console.error('Error connecting to MCP server:', error);
    
    // Reset the client if there was an error
    mcpClient = null;
    
    // Throw the error to be handled by the caller
    throw new Error(`Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Initial message endpoint
app.post('/analyze-message', async (req, res) => {
  console.log('Processing message');
  try {
    const { messageId, profileId, requestText } = req.body;

    if (!messageId || !profileId || !requestText) {
      return res.status(400).json({
        error: 'Missing required fields: messageId, profileId, or requestText'
      });
    }

    // Get the phone number from the original message
    const { data: message, error: messageError } = await supabase
      .from('incoming_twilio_messages')
      .select('from_number')
      .eq('id', messageId)
      .single();

    if (messageError) throw messageError;
    const phoneNumber = message.from_number;

    // Create a new conversation message
    const { data: newMessage, error: messageInsertError } = await supabase
      .from('conversation_messages')
      .insert({
        profile_id: profileId,
        phone_number: phoneNumber,
        direction: 'incoming',
        content: requestText,
        status: 'pending'
      })
      .select()
      .single();

    if (messageInsertError) throw messageInsertError;

    // Send acknowledgment to user
    await supabase.functions.invoke('send-sms', {
      body: {
        to: phoneNumber,
        message: "I'm processing your request. I'll get back to you shortly."
      }
    });

    res.json({
      success: true,
      message: "Request accepted and being processed",
      messageId: newMessage.id
    });

  } catch (error) {
    console.error('Error creating conversation message:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Process message endpoint (called by database trigger)
app.post('/process-message', async (req, res) => {
  try {
    const { message_id, profile_id, phone_number, content, direction, parent_message_id } = req.body;
    
    if (!message_id || !profile_id || !phone_number || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create a new message with pending status for the worker to process
    const { error: insertError } = await supabase
      .from('conversation_messages')
      .insert({
        id: message_id,  // Use the same ID that was sent
        profile_id,
        phone_number,
        direction,
        content,
        parent_message_id,
        status: 'pending'  // This is what the worker looks for
      });

    if (insertError) {
      console.error('Error creating pending message:', insertError);
      return res.status(500).json({ error: 'Failed to create pending message' });
    }

    // Quickly acknowledge the request
    res.json({ 
      success: true, 
      message: 'Message queued for processing',
      message_id 
    });
    
  } catch (error) {
    console.error('Error creating pending message:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Calendar endpoints (legacy endpoint for backward compatibility)
app.post('/create-calendar', async (req, res) => {
  try {
    const { events, title, timezone } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'events array is required' });
    }
    
    const result = await calendarTool.createCalendar({
      events,
      title,
      timezone
    });
    
    res.json(result);
  } catch (error) {
    console.error('Error creating calendar:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

app.get('/calendar/:calendarId', async (req, res) => {
  try {
    const { calendarId } = req.params;
    
    const html = await calendarTool.getCalendarHTML(calendarId);
    
    if (!html) {
      return res.status(404).send('Calendar not found');
    }
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error retrieving calendar:', error);
    res.status(500).send('Internal server error');
  }
});

app.get('/calendar/:calendarId/ical', async (req, res) => {
  try {
    const { calendarId } = req.params;
    
    const icalContent = await calendarTool.getCalendarICal(calendarId);
    
    if (!icalContent) {
      return res.status(404).send('Calendar not found');
    }
    
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="calendar.ics"`);
    res.send(icalContent);
  } catch (error) {
    console.error('Error retrieving calendar iCal:', error);
    res.status(500).send('Internal server error');
  }
});

// Help request endpoints
app.get('/help/:helpId', async (req, res) => {
  try {
    const { helpId } = req.params;
    
    const { HelpTool } = await import('./services/help-tool');
    const helpTool = new HelpTool(supabase);
    const html = await helpTool.getHelpRequestHTML(helpId);
    
    if (!html) {
      return res.status(404).send('Help request not found');
    }
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error retrieving help request:', error);
    res.status(500).send('Internal server error');
  }
});

// Form endpoints
app.get('/form/:formId', async (req, res) => {
  try {
    const { FormRenderer } = await import('./services/form-renderer');
    const html = FormRenderer.generateFormPage();
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error serving form page:', error);
    res.status(500).send('Internal server error');
  }
});

// Form configuration API endpoint
app.get('/api/form-config/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    
    const { FormGenerator } = await import('./services/form-generator');
    const formGenerator = new FormGenerator(supabase);
    const config = await formGenerator.getFormConfig(formId);
    
    if (!config) {
      return res.status(404).json({ error: 'Form not found or expired' });
    }
    
    // Return only the necessary fields for rendering
    res.json({
      form_title: config.form_title,
      schema: config.schema,
      ui_schema: config.ui_schema,
      submit_button_text: config.submit_button_text || 'Submit',
      success_message: config.success_message || 'Thank you! Your form has been submitted.'
    });
  } catch (error) {
    console.error('Error retrieving form config:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Form submission endpoint
app.post('/api/form-submit', async (req, res) => {
  try {
    const { formId, data } = req.body;
    
    if (!formId || !data) {
      return res.status(400).json({ error: 'Missing formId or data' });
    }
    
    // Get form details for context
    const { data: form, error: formError } = await supabase
      .from('dynamic_forms')
      .select('*')
      .eq('id', formId)
      .single();
    
    if (formError || !form) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    // Check if form is still active and not expired
    if (form.status !== 'active') {
      return res.status(400).json({ error: 'Form is no longer active' });
    }
    
    if (form.expires_at && new Date(form.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Form has expired' });
    }
    
    // Store form response
    const responseId = `response_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    const { error: responseError } = await supabase
      .from('form_responses')
      .insert({
        id: responseId,
        form_id: formId,
        response_data: data,
        process_as_message_to_profile_id: form.originating_profile_id,
        parent_conversation_thread_id: form.conversation_thread_id,
        submitted_at: new Date().toISOString()
      });
    
    if (responseError) {
      console.error('Error storing form response:', responseError);
      return res.status(500).json({ error: 'Failed to store response' });
    }
    
    // Update form status to submitted
    await supabase
      .from('dynamic_forms')
      .update({ status: 'submitted', updated_at: new Date().toISOString() })
      .eq('id', formId);
    
    res.json({ success: true, message: 'Form submitted successfully' });
    
  } catch (error) {
    console.error('Error processing form submission:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 