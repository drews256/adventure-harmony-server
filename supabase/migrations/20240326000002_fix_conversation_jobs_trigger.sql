-- Add request_text column if it doesn't exist
ALTER TABLE conversation_jobs 
ADD COLUMN IF NOT EXISTS request_text TEXT;

-- Make it NOT NULL with a default first
UPDATE conversation_jobs 
SET request_text = COALESCE(
    (SELECT content FROM conversation_messages WHERE id = conversation_jobs.message_id),
    ''
)
WHERE request_text IS NULL;

-- Now make it NOT NULL
ALTER TABLE conversation_jobs 
ALTER COLUMN request_text SET NOT NULL;

-- Update the trigger function to include request_text
CREATE OR REPLACE FUNCTION create_message_job()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create job for incoming messages
  IF NEW.direction = 'incoming' AND NEW.status = 'pending' THEN
    INSERT INTO conversation_jobs (message_id, profile_id, phone_number, request_text, job_type)
    VALUES (NEW.id, NEW.profile_id, NEW.phone_number, NEW.content, 'message');
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;