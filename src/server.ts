import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import type { ConversationJob } from './types';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase client
const SUPABASE_URL = "https://dhelbmzzhobadauctczs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Middleware
app.use(cors());
app.use(express.json());

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

    // Get the phone number from the original message
    const { data: message, error: messageError } = await supabase
      .from('incoming_twilio_messages')
      .select('from_number')
      .eq('id', messageId)
      .single();

    if (messageError) throw messageError;
    const phoneNumber = message.from_number;

    // Fetch previous conversation history
    const { data: history, error: historyError } = await supabase
      .from('claude_conversation_history')
      .select('*')
      .eq('phone_number', phoneNumber)
      .eq('profile_id', profileId)
      .limit(5)
      .order('created_at', { ascending: false });

    if (historyError) throw historyError;

    // Create a new conversation job
    const { data: job, error: jobError } = await supabase
      .from('conversation_jobs')
      .insert({
        message_id: messageId,
        profile_id: profileId,
        phone_number: phoneNumber,
        request_text: requestText,
        status: 'pending',
        current_step: 0,
        total_steps: 0,
        conversation_history: history || [],
        tool_results: [],
        final_response: null,
        error_message: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobError) throw jobError;

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
      jobId: job.id
    });

  } catch (error) {
    console.error('Error creating conversation job:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Job status endpoint
app.get('/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const { data: job, error } = await supabase
      .from('conversation_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error) throw error;
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      success: true,
      job
    });

  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 