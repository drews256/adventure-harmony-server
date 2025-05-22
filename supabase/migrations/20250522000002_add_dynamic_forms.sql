-- Add conversation thread tracking to existing messages table
ALTER TABLE conversation_messages 
  ADD COLUMN IF NOT EXISTS conversation_thread_id TEXT,
  ADD COLUMN IF NOT EXISTS form_response_id TEXT;

-- Create dynamic forms table
CREATE TABLE IF NOT EXISTS dynamic_forms (
  id TEXT PRIMARY KEY,
  
  -- Context preservation
  originating_profile_id TEXT NOT NULL,
  originating_message_id TEXT,
  conversation_thread_id TEXT,
  
  -- Form configuration
  form_type TEXT NOT NULL,
  form_title TEXT NOT NULL,
  schema JSONB NOT NULL,
  ui_schema JSONB,
  context JSONB,
  html_content TEXT NOT NULL,
  
  -- Customer info
  customer_phone TEXT,
  customer_name TEXT,
  
  -- Status and lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create form responses table
CREATE TABLE IF NOT EXISTS form_responses (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES dynamic_forms(id) ON DELETE CASCADE,
  
  -- Response data
  response_data JSONB NOT NULL,
  
  -- Context continuation
  process_as_message_to_profile_id TEXT NOT NULL,
  parent_conversation_thread_id TEXT,
  
  -- Processing status
  processed BOOLEAN DEFAULT FALSE,
  processing_message_id TEXT,
  processing_error TEXT,
  
  -- Timestamps
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_dynamic_forms_originating_profile ON dynamic_forms(originating_profile_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_forms_thread ON dynamic_forms(conversation_thread_id);
CREATE INDEX IF NOT EXISTS idx_dynamic_forms_status ON dynamic_forms(status);
CREATE INDEX IF NOT EXISTS idx_dynamic_forms_expires ON dynamic_forms(expires_at);

CREATE INDEX IF NOT EXISTS idx_form_responses_form_id ON form_responses(form_id);
CREATE INDEX IF NOT EXISTS idx_form_responses_unprocessed ON form_responses(processed, submitted_at) WHERE NOT processed;
CREATE INDEX IF NOT EXISTS idx_form_responses_profile ON form_responses(process_as_message_to_profile_id);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread ON conversation_messages(conversation_thread_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_form_response ON conversation_messages(form_response_id);

-- Add RLS policies (commented out for now)
-- ALTER TABLE dynamic_forms ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE form_responses ENABLE ROW LEVEL SECURITY;

-- Create policies for form access
-- CREATE POLICY "Public read access for active forms" ON dynamic_forms
--   FOR SELECT USING (status = 'active' AND (expires_at IS NULL OR expires_at > NOW()));

-- CREATE POLICY "System can manage forms" ON dynamic_forms
--   FOR ALL USING (true);

-- CREATE POLICY "Public can submit form responses" ON form_responses
--   FOR INSERT WITH CHECK (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION update_dynamic_forms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS trigger_dynamic_forms_updated_at ON dynamic_forms;
CREATE TRIGGER trigger_dynamic_forms_updated_at
  BEFORE UPDATE ON dynamic_forms
  FOR EACH ROW
  EXECUTE FUNCTION update_dynamic_forms_updated_at();