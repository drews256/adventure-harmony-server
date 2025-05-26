-- Add conversation structure columns to conversation_messages
-- These columns improve message organization and tracking

-- Add conversation_id to group related messages
ALTER TABLE conversation_messages 
ADD COLUMN IF NOT EXISTS conversation_id UUID DEFAULT gen_random_uuid() NOT NULL;

-- Add thread_id for sub-conversations within a conversation
ALTER TABLE conversation_messages 
ADD COLUMN IF NOT EXISTS thread_id UUID;

-- Add metadata for flexible data storage (tool results, protocol data, etc.)
ALTER TABLE conversation_messages 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add from_number and to_number for clearer SMS tracking
ALTER TABLE conversation_messages 
ADD COLUMN IF NOT EXISTS from_number TEXT;

ALTER TABLE conversation_messages 
ADD COLUMN IF NOT EXISTS to_number TEXT;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id 
ON conversation_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread_id 
ON conversation_messages(thread_id);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_status_direction 
ON conversation_messages(status, direction);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_phone_number 
ON conversation_messages(phone_number);

-- Add GIN index for JSONB metadata queries
CREATE INDEX IF NOT EXISTS idx_conversation_messages_metadata 
ON conversation_messages USING GIN (metadata);

-- Update existing messages to have consistent conversation_ids
-- Group messages by phone number and parent chain
DO $$
DECLARE
    msg RECORD;
    conv_id UUID;
BEGIN
    -- For each root message (no parent), assign a conversation_id
    FOR msg IN 
        SELECT id, phone_number 
        FROM conversation_messages 
        WHERE parent_message_id IS NULL 
        AND conversation_id = gen_random_uuid()
    LOOP
        conv_id := gen_random_uuid();
        
        -- Update the root message
        UPDATE conversation_messages 
        SET conversation_id = conv_id 
        WHERE id = msg.id;
        
        -- Update all children with the same conversation_id
        WITH RECURSIVE message_tree AS (
            SELECT id, parent_message_id, conv_id as conversation_id
            FROM conversation_messages
            WHERE id = msg.id
            
            UNION ALL
            
            SELECT cm.id, cm.parent_message_id, mt.conversation_id
            FROM conversation_messages cm
            INNER JOIN message_tree mt ON cm.parent_message_id = mt.id
        )
        UPDATE conversation_messages
        SET conversation_id = message_tree.conversation_id
        FROM message_tree
        WHERE conversation_messages.id = message_tree.id;
    END LOOP;
END $$;

-- Migrate phone_number to from_number/to_number based on direction
UPDATE conversation_messages 
SET from_number = phone_number 
WHERE direction = 'incoming' AND from_number IS NULL;

UPDATE conversation_messages 
SET to_number = phone_number 
WHERE direction = 'outgoing' AND to_number IS NULL;

-- Add comment to explain column purposes
COMMENT ON COLUMN conversation_messages.conversation_id IS 'Groups all messages in a conversation together';
COMMENT ON COLUMN conversation_messages.thread_id IS 'Optional sub-thread within a conversation for branching discussions';
COMMENT ON COLUMN conversation_messages.metadata IS 'Flexible JSONB storage for tool results, protocol data, and other message metadata';
COMMENT ON COLUMN conversation_messages.from_number IS 'Phone number of the message sender';
COMMENT ON COLUMN conversation_messages.to_number IS 'Phone number of the message recipient';