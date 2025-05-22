-- Add conversation_history column to conversation_messages
ALTER TABLE conversation_messages
ADD COLUMN conversation_history JSONB;

-- Add tool_result_for column to track which tool call this result is for
ALTER TABLE conversation_messages
ADD COLUMN tool_result_for TEXT;

-- Add index for better query performance
CREATE INDEX idx_conversation_messages_tool_result_for ON conversation_messages(tool_result_for);