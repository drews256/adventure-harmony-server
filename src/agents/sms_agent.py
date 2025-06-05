"""
SMS Message Agent using Agno Framework

This agent handles incoming SMS messages, processes them with Claude,
and executes tool calls via MCP server integration.
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime

import agno
from agno.agent import Agent
from agno.models.anthropic import Claude
from supabase import Client as SupabaseClient

# Import our Streamable HTTP-based MCP client
try:
    # Try relative import first (for when imported as package)
    from .mcp_streamable_client import MCPStreamableClient, create_mcp_client
except ImportError:
    # Fall back to absolute import (for when imported directly)
    from mcp_streamable_client import MCPStreamableClient, create_mcp_client

logger = logging.getLogger(__name__)

class MCPTool:
    """Wrapper for MCP tools to work with Agno"""
    
    def __init__(self, name: str, description: str, mcp_client: MCPStreamableClient):
        self.name = name
        self.description = description
        self.mcp_client = mcp_client
        self._mcp_tool_name = name
    
    async def execute(self, **kwargs) -> Dict[str, Any]:
        """Execute the MCP tool"""
        try:
            # Call the MCP tool
            result = await self.mcp_client.call_tool(self._mcp_tool_name, kwargs)
            
            # Extract the result data
            if isinstance(result, dict):
                if 'error' in result:
                    return {
                        "success": False,
                        "error": result['error']
                    }
                elif 'result' in result:
                    return {
                        "success": True,
                        "data": result['result']
                    }
                else:
                    return {
                        "success": True,
                        "data": str(result)
                    }
            else:
                return {
                    "success": True,
                    "data": str(result)
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }


class SMSAgent:
    """Agent for handling SMS messages using Agno and MCP"""
    
    def __init__(self, supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None):
        self.supabase = supabase_client
        self.mcp_server_url = mcp_server_url
        self.profile_id = profile_id
        # Agent will be created during initialization
        self.mcp_client: Optional[MCPStreamableClient] = None
        self.agent = None
        
    async def initialize(self):
        """Initialize the agent with MCP tools"""
        # Initialize MCP client and get tools
        try:
            await self._init_mcp_client()
            tools = await self._get_mcp_tools()
            logger.info(f"Loaded {len(tools)} tools from MCP server")
        except Exception as e:
            logger.warning(f"Failed to initialize MCP client: {e}")
            logger.warning("Agent will run without tools")
            tools = []
        
        # Create Agno agent
        logger.info(f"Creating Agno agent with {len(tools)} tools")
        self.agent = Agent(
            model=Claude(id="claude-3-5-sonnet-20241022"),
            instructions="""You are a helpful SMS assistant for Adventure Harmony Planner.
            You help users with:
            - Booking tours, activities, and rentals
            - Checking weather information
            - Managing their calendar
            - Answering questions about destinations
            
            Always be concise and friendly. Remember that responses will be sent via SMS,
            so keep them brief and to the point.""",
            tools=tools
        )
        logger.info(f"Agno agent created successfully with tools: {[t.name for t in tools]}")

    async def _init_mcp_client(self):
        """Initialize MCP client connection"""
        # Create full server URL
        if self.mcp_server_url.startswith('http://') or self.mcp_server_url.startswith('https://'):
            server_url = self.mcp_server_url
        else:
            # Default to http if no protocol specified
            server_url = f"http://{self.mcp_server_url}"
        
        # Create and connect MCP client with profile_id
        self.mcp_client = await create_mcp_client(server_url, profile_id=self.profile_id)
    
    async def _get_mcp_tools(self) -> List[MCPTool]:
        """Get available tools from MCP server and wrap them for Agno"""
        tools = []
        
        logger.info(f"Converting {len(self.mcp_client.tools)} MCP tools to Agno tools")
        
        # Tools are already loaded in mcp_client.tools
        for i, tool in enumerate(self.mcp_client.tools):
            # Create Agno-compatible tool wrapper
            agno_tool = MCPTool(
                name=tool.name,
                description=tool.description or f"MCP tool: {tool.name}",
                mcp_client=self.mcp_client
            )
            tools.append(agno_tool)
            logger.debug(f"  Tool {i+1}: {tool.name}")
        
        logger.info(f"Created {len(tools)} Agno-compatible tools")
        return tools
    
    async def process_message(self, message: str, conversation_id: str, phone_number: str) -> str:
        """Process an incoming SMS message and return response"""
        
        logger.info(f"Processing message for conversation {conversation_id}, phone {phone_number}")
        logger.info(f"Agent has {len(self.agent.tools) if hasattr(self.agent, 'tools') else 0} tools available")
        
        # Get conversation history
        history = await self._get_conversation_history(conversation_id)
        
        # Create session context
        session_data = {
            "conversation_id": conversation_id,
            "phone_number": phone_number,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        logger.info(f"Running agent with message: {message[:50]}...")
        
        # Run the agent (synchronous method)
        response = self.agent.run(message=message, messages=history, stream=False)
        
        logger.info(f"Agent completed processing")
        
        # Extract the response text
        if hasattr(response, 'content'):
            return response.content
        else:
            return str(response)
    
    async def _get_conversation_history(self, conversation_id: str) -> List[Dict[str, str]]:
        """Get conversation history from database"""
        try:
            # Query recent messages for this conversation
            result = self.supabase.table('conversation_messages').select(
                'content,direction'
            ).eq(
                'conversation_id', conversation_id
            ).order(
                'created_at', desc=False
            ).limit(10).execute()
            
            # Convert to format expected by Agno
            history = []
            for msg in result.data:
                if msg['direction'] == 'incoming':
                    history.append({
                        'role': 'user',
                        'content': msg['content']
                    })
                else:
                    history.append({
                        'role': 'assistant', 
                        'content': msg['content']
                    })
            
            return history
            
        except Exception as e:
            print(f"Error getting conversation history: {e}")
            return []
    
    async def cleanup(self):
        """Clean up resources"""
        if self.mcp_client:
            await self.mcp_client.close()


# Factory function to create agent
async def create_sms_agent(supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None) -> SMSAgent:
    """Create and initialize SMS agent"""
    agent = SMSAgent(supabase_client, mcp_server_url, profile_id)
    await agent.initialize()
    return agent