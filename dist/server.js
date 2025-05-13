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
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseServiceKey);
// Initialize Anthropic client
const anthropic = new sdk_1.Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
});
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});
// Message analysis endpoint
app.post('/analyze-message', async (req, res) => {
    try {
        const { messageId, profileId, requestText } = req.body;
        if (!messageId || !profileId || !requestText) {
            return res.status(400).json({
                error: 'Missing required fields: messageId, profileId, or requestText'
            });
        }
        // Create analysis record
        const { data: analysis, error: analysisError } = await supabase
            .from('message_analysis')
            .insert({
            message_id: messageId,
            profile_id: profileId,
            request_text: requestText,
            status: 'pending',
            analysis_started_at: new Date().toISOString()
        })
            .select()
            .single();
        if (analysisError)
            throw analysisError;
        // Get the phone number from the original message
        const { data: message, error: messageError } = await supabase
            .from('incoming_twilio_messages')
            .select('from_number')
            .eq('id', messageId)
            .single();
        if (messageError)
            throw messageError;
        const phoneNumber = message.from_number;
        // Fetch conversation events
        const { data: events, error: eventsError } = await supabase
            .from('calendar_events')
            .select('*')
            .eq('profile_id', profileId)
            .gte('start_time', new Date().toISOString())
            .order('start_time', { ascending: true })
            .limit(10);
        if (eventsError)
            throw eventsError;
        // Fetch previous conversation history
        const { data: history, error: historyError } = await supabase
            .from('claude_conversation_history')
            .select('*')
            .eq('phone_number', phoneNumber)
            .eq('profile_id', profileId)
            .order('created_at', { ascending: true });
        if (historyError)
            throw historyError;
        // Build message history
        const anthropicMessages = history?.map(msg => ({
            role: msg.role,
            content: msg.content
        })) || [];
        // Add the current request
        const userContent = `Here's the context:
      Upcoming Events: ${JSON.stringify(events)}
      Current Request: ${requestText}
      
      Please analyze this information and provide a response. Remember to:
      1. Use America/Los_Angeles timezone for all times
      2. Format dates in a user-friendly way
      3. Be clear about event durations
      4. Include timezone information when relevant
      5. Group events by date when listing multiple events`;
        // Call Claude
        const response = await anthropic.messages.create({
            model: 'claude-3-opus-20240229',
            max_tokens: 1000,
            messages: [
                ...anthropicMessages,
                {
                    role: 'user',
                    content: userContent
                }
            ],
        });
        // Extract text content from response, filtering out any tool use blocks
        const responseText = response.content
            .filter(block => block.type === 'text')
            .map(block => (block.type === 'text' ? block.text : ''))
            .join('\n');
        // Save the user message to conversation history
        await supabase.from('claude_conversation_history').insert({
            profile_id: profileId,
            phone_number: phoneNumber,
            role: 'user',
            content: userContent,
            message_id: messageId
        });
        // Save Claude's response to conversation history
        await supabase.from('claude_conversation_history').insert({
            profile_id: profileId,
            phone_number: phoneNumber,
            role: 'assistant',
            content: responseText,
            message_id: messageId
        });
        // Update analysis record with response
        await supabase
            .from('message_analysis')
            .update({
            response_text: responseText,
            status: 'completed',
            analysis_completed_at: new Date().toISOString()
        })
            .eq('id', analysis.id);
        // Send response back via SMS
        await supabase.functions.invoke('send-sms', {
            body: {
                to: phoneNumber,
                message: responseText
            }
        });
        res.json({
            success: true,
            response: responseText
        });
    }
    catch (error) {
        console.error('Error in analyze-message endpoint:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
