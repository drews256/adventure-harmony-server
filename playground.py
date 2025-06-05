#!/usr/bin/env python3
"""
Agno Playground for testing the SMS agent with MCP tools

Usage:
1. Install dependencies: pip install agno 'fastapi[standard]' sqlalchemy
2. Export your API keys:
   - export ANTHROPIC_API_KEY=your-key
   - export SUPABASE_URL=your-url
   - export SUPABASE_SERVICE_ROLE_KEY=your-key
   - export MCP_SERVER_URL=your-mcp-server-url (optional)
3. Run: python playground.py
4. Navigate to http://app.agno.com/playground
5. Select localhost:7777 endpoint
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add agents directory to path
agents_path = os.path.join(os.path.dirname(__file__), 'src', 'agents')
sys.path.append(agents_path)

from agno.agent import Agent
from agno.models.anthropic import Claude
from agno.playground import Playground, serve_playground_app
from agno.storage.sqlite import SqliteStorage
from supabase import create_client
import asyncio

# Import our custom MCP tools
from mcp_streamable_client import MCPStreamableClient, create_mcp_client

# Initialize storage
storage_path = Path("./tmp")
storage_path.mkdir(exist_ok=True)
agent_storage = str(storage_path / "agents.db")

# Initialize Supabase client
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(supabase_url, supabase_key) if supabase_url and supabase_key else None

# MCP server configuration
mcp_server_url = os.getenv("MCP_SERVER_URL", "https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com")


def create_mcp_tool_function(tool_name: str, tool_description: str, mcp_client: MCPStreamableClient):
    """Create a function that calls an MCP tool"""
    
    async def mcp_tool_executor(**kwargs):
        """Execute MCP tool with given arguments"""
        try:
            result = await mcp_client.call_tool(tool_name, kwargs)
            
            if isinstance(result, dict):
                if 'error' in result:
                    return {"success": False, "error": result['error']}
                elif 'result' in result:
                    return {"success": True, "data": result['result']}
                else:
                    return {"success": True, "data": str(result)}
            else:
                return {"success": True, "data": str(result)}
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    # Set function metadata for Agno
    mcp_tool_executor.__name__ = tool_name
    mcp_tool_executor.__doc__ = tool_description
    
    return mcp_tool_executor


# Create playground app
print("Setting up Agno playground...")
print(f"MCP Server URL: {mcp_server_url}")

# For now, create a simple agent without async MCP tools
# MCP tools require complex async setup that conflicts with uvicorn
sms_agent = Agent(
    name="SMS Assistant",
    role="SMS messaging assistant for Adventure Harmony Planner",
    model=Claude(id="claude-3-5-sonnet-20241022"),
    instructions=[
        "You are a helpful SMS assistant for Adventure Harmony Planner.",
        "You help users with:",
        "- Booking tours, activities, and rentals",
        "- Checking weather information",
        "- Managing their calendar",
        "- Answering questions about destinations",
        "",
        "Always be concise and friendly. Remember that responses will be sent via SMS,",
        "so keep them brief and to the point.",
        "Note: In playground mode, external tools are not available."
    ],
    markdown=True,
    show_tool_calls=True,
    storage=SqliteStorage(table_name="sms_agent", db_file=agent_storage),
)

agents = [sms_agent]

# Create playground app
app = Playground(agents=agents).get_app()

# Note about MCP tools in playground
print("\n⚠️  Note: MCP tools are not available in playground mode due to async constraints.")
print("    Use the production worker for full tool integration.\n")

if __name__ == "__main__":
    print(f"✅ Playground ready with SMS Assistant agent")
    print("🌐 Navigate to http://app.agno.com/playground")
    print("🔌 Select 'localhost:7777' as the endpoint")
    
    # Serve the playground
    serve_playground_app("playground:app", port=7777, reload=True)