#!/usr/bin/env python3
"""
Agno Playground for testing the SMS agent with MCP tools

Usage:
1. Install dependencies: pip install agno 'fastapi[standard]' sqlalchemy
2. Export your API keys:
   - export ANTHROPIC_API_KEY=your-key
   - export AGNO_API_KEY=your-key (optional)
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

from agno import Agent, Playground
from agno.models.anthropic import Claude
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


async def create_mcp_tools(profile_id=None):
    """Create MCP tools for the agent"""
    try:
        # Create and connect MCP client
        mcp_client = await create_mcp_client(mcp_server_url, profile_id=profile_id)
        
        # Create tool functions
        tools = []
        for tool in mcp_client.tools:
            # Create a function for each MCP tool
            async def tool_function(**kwargs):
                return await mcp_client.call_tool(tool.name, kwargs)
            
            tool_function.__name__ = tool.name
            tool_function.__doc__ = tool.description
            tools.append(tool_function)
        
        return tools, mcp_client
    except Exception as e:
        print(f"Failed to initialize MCP tools: {e}")
        return [], None


async def setup_agents():
    """Set up agents for the playground"""
    agents = []
    
    # Create SMS agent with MCP tools
    tools, mcp_client = await create_mcp_tools()
    
    sms_agent = Agent(
        name="SMS Assistant",
        role="SMS messaging assistant for Adventure Harmony Planner",
        model=Claude(id="claude-3-5-sonnet-20241022"),
        instructions=[
            "You are a helpful SMS assistant for Adventure Harmony Planner.",
            "Help users with booking tours, activities, and rentals.",
            "Check weather information and manage calendars.",
            "Answer questions about destinations.",
            "Always be concise and friendly - remember responses are sent via SMS.",
            "Keep responses brief and to the point.",
            f"You have access to {len(tools)} tools for searching activities, making bookings, etc."
        ],
        markdown=True,
        show_tool_calls=True,
        tools=tools,
        storage=SqliteStorage(table_name="sms_agent", db_file=agent_storage),
    )
    agents.append(sms_agent)
    
    # Create a simple agent without tools for comparison
    simple_agent = Agent(
        name="Simple Assistant",
        role="Basic assistant without tools",
        model=Claude(id="claude-3-5-sonnet-20241022"),
        instructions=[
            "You are a helpful assistant without access to external tools.",
            "Provide general information and guidance.",
            "Be friendly and concise."
        ],
        markdown=True,
        storage=SqliteStorage(table_name="simple_agent", db_file=agent_storage),
    )
    agents.append(simple_agent)
    
    return agents, mcp_client


async def main():
    """Run the playground"""
    print("Setting up Agno playground...")
    print(f"MCP Server URL: {mcp_server_url}")
    
    # Create agents
    agents, mcp_client = await setup_agents()
    
    # Create playground
    playground = Playground(agents=agents)
    
    print(f"✅ Playground ready with {len(agents)} agents")
    print("🌐 Navigate to http://app.agno.com/playground")
    print("🔌 Select 'localhost:7777' as the endpoint")
    
    try:
        # Serve the playground (this will block)
        playground.serve(port=7777)
    finally:
        # Clean up MCP client
        if mcp_client:
            await mcp_client.close()


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())