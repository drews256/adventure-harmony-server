-- Add morning_update_settings column to profiles table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'profiles' 
                   AND column_name = 'morning_update_settings') THEN
        ALTER TABLE profiles 
        ADD COLUMN morning_update_settings JSONB DEFAULT '{"enabled": false, "time": "08:00", "timezone": "America/Denver"}'::jsonb;
    END IF;
END $$;

-- Update existing profiles to have default morning update settings if null
UPDATE profiles 
SET morning_update_settings = '{"enabled": false, "time": "08:00", "timezone": "America/Denver"}'::jsonb
WHERE morning_update_settings IS NULL;