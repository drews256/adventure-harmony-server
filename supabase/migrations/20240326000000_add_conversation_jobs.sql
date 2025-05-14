-- Create the set_updated_at function if it doesn't exist
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create enum for job status
CREATE TYPE conversation_job_status AS ENUM (
  'pending',
  'processing',
  'waiting_for_tool',
  'tool_complete',
  'completed',
  'failed'
);

-- Create conversation jobs table
CREATE TABLE conversation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES incoming_twilio_messages(id),
  profile_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  request_text TEXT NOT NULL,
  status conversation_job_status NOT NULL DEFAULT 'pending',
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 0,
  conversation_history JSONB NOT NULL DEFAULT '[]',
  tool_results JSONB NOT NULL DEFAULT '[]',
  final_response TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_conversation_jobs_status ON conversation_jobs(status);
CREATE INDEX idx_conversation_jobs_created_at ON conversation_jobs(created_at);
CREATE INDEX idx_conversation_jobs_message_id ON conversation_jobs(message_id);
CREATE INDEX idx_conversation_jobs_profile_id ON conversation_jobs(profile_id);
CREATE INDEX idx_conversation_jobs_phone_number ON conversation_jobs(phone_number);

-- Add trigger to update updated_at
CREATE TRIGGER set_conversation_jobs_updated_at
  BEFORE UPDATE ON conversation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at(); 