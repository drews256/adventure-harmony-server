-- Create conversation_jobs table for message processing queue
CREATE TABLE conversation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES conversation_messages(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'message', -- 'message' or 'morning_update'
  profile_id UUID,
  phone_number TEXT,
  metadata JSONB,
  status message_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_conversation_jobs_status ON conversation_jobs(status);
CREATE INDEX idx_conversation_jobs_job_type ON conversation_jobs(job_type);
CREATE INDEX idx_conversation_jobs_message_id ON conversation_jobs(message_id);
CREATE INDEX idx_conversation_jobs_created_at ON conversation_jobs(created_at);

-- Add trigger to update updated_at
CREATE TRIGGER set_conversation_jobs_updated_at
  BEFORE UPDATE ON conversation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Create a job automatically when a new message is inserted
CREATE OR REPLACE FUNCTION create_message_job()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create job for incoming messages
  IF NEW.direction = 'incoming' AND NEW.status = 'pending' THEN
    INSERT INTO conversation_jobs (message_id, profile_id, phone_number, job_type)
    VALUES (NEW.id, NEW.profile_id, NEW.phone_number, 'message');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to create jobs for new messages
CREATE TRIGGER trigger_create_message_job
  AFTER INSERT ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION create_message_job();