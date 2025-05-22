-- Create table for storing help requests
CREATE TABLE IF NOT EXISTS help_requests (
  id TEXT PRIMARY KEY,
  conversation_summary TEXT NOT NULL,
  specific_issue TEXT,
  urgency TEXT DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high')),
  user_context TEXT,
  html_content TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_help_requests_created_at ON help_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_requests_status ON help_requests(status);
CREATE INDEX IF NOT EXISTS idx_help_requests_urgency ON help_requests(urgency);

-- Add RLS policy (if RLS is enabled)
-- ALTER TABLE help_requests ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows public read access for help requests (for viewing the help page)
-- CREATE POLICY "Public read access for help requests" ON help_requests
--   FOR SELECT USING (true);

-- Create a policy that allows system to create help requests
-- CREATE POLICY "System can create help requests" ON help_requests
--   FOR INSERT WITH CHECK (true);