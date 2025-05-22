-- Create table for storing calendar displays
CREATE TABLE IF NOT EXISTS calendar_displays (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  ical_url TEXT NOT NULL,
  html_content TEXT NOT NULL,
  event_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_calendar_displays_created_at ON calendar_displays(created_at DESC);

-- Add RLS policy (if RLS is enabled)
-- ALTER TABLE calendar_displays ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows public read access for calendar displays
-- CREATE POLICY "Public read access for calendar displays" ON calendar_displays
--   FOR SELECT USING (true);

-- Create a policy that allows authenticated users to create calendar displays
-- CREATE POLICY "Authenticated users can create calendar displays" ON calendar_displays
--   FOR INSERT WITH CHECK (true);