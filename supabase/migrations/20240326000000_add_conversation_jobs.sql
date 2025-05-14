-- Create the set_updated_at function if it doesn't exist
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create enum for message direction
CREATE TYPE message_direction AS ENUM (
  'incoming',
  'outgoing'
);

-- Create enum for message status
CREATE TYPE message_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

-- Create conversation messages table
CREATE TABLE conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL,
  phone_number TEXT NOT NULL,
  direction message_direction NOT NULL,
  content TEXT NOT NULL,
  parent_message_id UUID REFERENCES conversation_messages(id),
  tool_calls JSONB,
  tool_results JSONB,
  status message_status NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_conversation_messages_status ON conversation_messages(status);
CREATE INDEX idx_conversation_messages_profile_id ON conversation_messages(profile_id);
CREATE INDEX idx_conversation_messages_phone_number ON conversation_messages(phone_number);
CREATE INDEX idx_conversation_messages_parent ON conversation_messages(parent_message_id);
CREATE INDEX idx_conversation_messages_direction ON conversation_messages(direction);

-- Add trigger to update updated_at
CREATE TRIGGER set_conversation_messages_updated_at
  BEFORE UPDATE ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Function to notify our API when a message needs processing
CREATE OR REPLACE FUNCTION notify_message_processor()
RETURNS TRIGGER AS $$
DECLARE
  webhook_url text := 'https://your-api-url/process-message';  -- Replace with your actual API URL
  payload json;
BEGIN
  -- Only notify for messages that need processing
  IF (TG_OP = 'INSERT' AND NEW.status = 'pending') OR
     (TG_OP = 'UPDATE' AND NEW.status = 'pending' AND OLD.status != 'pending') THEN
    
    -- Construct the payload
    payload := json_build_object(
      'message_id', NEW.id,
      'profile_id', NEW.profile_id,
      'phone_number', NEW.phone_number,
      'content', NEW.content,
      'direction', NEW.direction,
      'parent_message_id', NEW.parent_message_id,
      'tool_results', NEW.tool_results
    );

    -- Make HTTP POST request to our API using pg_net
    PERFORM pg_net.http_post(
      url => webhook_url,
      body => payload::text,
      headers => jsonb_build_object(
        'Content-Type', 'application/json'
      )
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for message processing
CREATE TRIGGER trigger_message_processor
  AFTER INSERT OR UPDATE ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_message_processor(); 