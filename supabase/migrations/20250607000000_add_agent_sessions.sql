-- Create agent_sessions table for Agno session storage
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT,
    memory JSONB,
    agent_data JSONB,
    session_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user_id ON agent_sessions(user_id);

-- Create index on updated_at for cleanup queries
CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated_at ON agent_sessions(updated_at);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_agent_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agent_sessions_updated_at
BEFORE UPDATE ON agent_sessions
FOR EACH ROW
EXECUTE FUNCTION update_agent_sessions_updated_at();

-- Add comment
COMMENT ON TABLE agent_sessions IS 'Stores Agno agent session data for conversation continuity';