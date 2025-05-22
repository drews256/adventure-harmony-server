"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
const sdk_1 = require("@anthropic-ai/sdk");
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/client/sse.js");
const calendar_tool_1 = require("./services/calendar-tool");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Initialize Supabase client
const SUPABASE_URL = "https://dhelbmzzhobadauctczs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
// Initialize calendar tool
const calendarTool = new calendar_tool_1.CalendarTool(supabase);
const anthropic = new sdk_1.Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});
let mcpClient = null;
async function ensureMcpConnection() {
    try {
        if (!mcpClient) {
            const clientId = `mcp-client-cli-${Date.now()}`;
            console.log(`Creating new MCP client: ${clientId}`);
            mcpClient = new index_js_1.Client({ name: clientId, version: "1.0.0" });
            // Use StreamableHTTP transport instead of SSE for more reliability
            // Log the transport creation
            console.log("Creating MCP client transport");
            // Important: Use /mcp endpoint for proper StreamableHTTP transport
            const transportUrl = new URL("https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com/mcp");
            console.log(`Using transport URL: ${transportUrl.toString()}`);
            const transport = new sse_js_1.SSEClientTransport(transportUrl);
            // Log transport details
            console.log(`Transport created: ${transport.constructor.name}`);
            console.log('Starting new MCP connection with SSE transport');
            await mcpClient.connect(transport);
            console.log('MCP client connected successfully');
        }
        return mcpClient;
    }
    catch (error) {
        console.error('Error connecting to MCP server:', error);
        // Reset the client if there was an error
        mcpClient = null;
        // Throw the error to be handled by the caller
        throw new Error(`Failed to connect to MCP server: ${error instanceof Error ? error.message : String(error)}`);
    }
}
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
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
        if (messageError)
            throw messageError;
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
        if (messageInsertError)
            throw messageInsertError;
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
    }
    catch (error) {
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
            id: message_id, // Use the same ID that was sent
            profile_id,
            phone_number,
            direction,
            content,
            parent_message_id,
            status: 'pending' // This is what the worker looks for
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
    }
    catch (error) {
        console.error('Error creating pending message:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});
// Calendar endpoints
app.post('/create-calendar', async (req, res) => {
    try {
        const { icalUrl, title, timezone } = req.body;
        if (!icalUrl) {
            return res.status(400).json({ error: 'icalUrl is required' });
        }
        const result = await calendarTool.createCalendar({
            icalUrl,
            title,
            timezone
        });
        res.json(result);
    }
    catch (error) {
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
    }
    catch (error) {
        console.error('Error retrieving calendar:', error);
        res.status(500).send('Internal server error');
    }
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
