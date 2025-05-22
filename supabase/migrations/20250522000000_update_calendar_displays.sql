-- Update calendar_displays table to support generated iCal content
ALTER TABLE calendar_displays 
  ADD COLUMN IF NOT EXISTS ical_content TEXT,
  ALTER COLUMN ical_url DROP NOT NULL;

-- Update existing records to have NULL ical_url if they don't have one
UPDATE calendar_displays SET ical_url = NULL WHERE ical_url = '';