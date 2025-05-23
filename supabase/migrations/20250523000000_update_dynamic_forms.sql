-- Update dynamic_forms table to remove html_content and add new fields
ALTER TABLE dynamic_forms 
DROP COLUMN IF EXISTS html_content,
ADD COLUMN IF NOT EXISTS submit_button_text TEXT DEFAULT 'Submit',
ADD COLUMN IF NOT EXISTS success_message TEXT DEFAULT 'Thank you! Your form has been submitted.';