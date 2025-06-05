"""
SMS Message Agent using Agno Framework with functional tools

This agent handles incoming SMS messages, processes them with Claude,
and executes tool calls via MCP server integration using functions.
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from functools import partial

import agno
from agno.agent import Agent
from agno.models.anthropic import Claude
from supabase import Client as SupabaseClient

# Import our Streamable HTTP-based MCP client
try:
    # Try relative import first (for when imported as package)
    from .mcp_streamable_client import MCPStreamableClient, create_mcp_client
    from .agno_tool_wrapper import create_agno_tool
except ImportError:
    # Fall back to absolute import (for when imported directly)
    from mcp_streamable_client import MCPStreamableClient, create_mcp_client
    from agno_tool_wrapper import create_agno_tool

logger = logging.getLogger(__name__)


def create_mcp_tool_function(tool_name: str, tool_description: str, tool_schema: Dict[str, Any], mcp_client: MCPStreamableClient):
    """Create a function that calls an MCP tool"""
    
    async def mcp_tool_executor(**kwargs) -> Dict[str, Any]:
        """Execute MCP tool with given arguments"""
        print(f"TOOL EXECUTE CALLED: {tool_name} with args: {kwargs}", flush=True)
        try:
            # Call the MCP tool
            result = await mcp_client.call_tool(tool_name, kwargs)
            
            print(f"TOOL RESULT: {result}", flush=True)
            
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
            print(f"TOOL EXECUTE ERROR: {e}", flush=True)
            return {
                "success": False,
                "error": str(e)
            }
    
    # Set function metadata for Agno
    mcp_tool_executor.__name__ = tool_name
    mcp_tool_executor.__doc__ = tool_description
    
    # Attach schema for Agno - convert MCP schema to Agno format
    # Agno expects the schema to be attached as __agno_schema__
    if tool_schema and isinstance(tool_schema, dict):
        # Ensure the schema is in the correct format
        # If it has 'properties', wrap it properly
        if 'properties' in tool_schema and 'type' not in tool_schema:
            tool_schema['type'] = 'object'
        
        mcp_tool_executor.__agno_schema__ = tool_schema
    
    return mcp_tool_executor


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
        print(f"SMS AGENT INITIALIZING WITH MCP URL: {self.mcp_server_url}, PROFILE: {self.profile_id}", flush=True)
        try:
            await self._init_mcp_client()
            tools = await self._get_mcp_tools()
            print(f"SMS AGENT GOT {len(tools)} TOOLS FROM MCP", flush=True)
            logger.info(f"Loaded {len(tools)} tools from MCP server")
        except Exception as e:
            print(f"SMS AGENT MCP INIT FAILED: {e}", flush=True)
            logger.warning(f"Failed to initialize MCP client: {e}")
            logger.warning("Agent will run without tools")
            tools = []
        
        # Create Agno agent
        print(f"CREATING AGNO AGENT WITH {len(tools)} TOOLS", flush=True)
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
        print(f"AGNO AGENT CREATED - VERIFYING TOOLS...", flush=True)
        if hasattr(self.agent, 'tools'):
            print(f"AGNO AGENT HAS {len(self.agent.tools)} TOOLS ATTRIBUTE", flush=True)
        else:
            print("AGNO AGENT HAS NO TOOLS ATTRIBUTE", flush=True)
        logger.info(f"Agno agent created with {len(tools)} tools")

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
    
    async def _get_mcp_tools(self) -> List[Any]:
        """Get available tools from MCP server and create functions for Agno"""
        tools = []
        
        # Tools are already loaded in mcp_client.tools
        for tool in self.mcp_client.tools:
            # Log tool details for debugging
            print(f"MCP TOOL: {tool.name}, has input_schema: {hasattr(tool, 'input_schema')}", flush=True)
            if hasattr(tool, 'input_schema'):
                print(f"MCP TOOL SCHEMA: {json.dumps(tool.input_schema, indent=2)}", flush=True)
            
            # Skip tools with potentially invalid schemas
            if hasattr(tool, 'input_schema') and tool.input_schema:
                # Check if schema looks valid
                schema = tool.input_schema
                if not isinstance(schema, dict) or '$schema' in schema:
                    print(f"SKIPPING TOOL {tool.name} - potentially invalid schema format", flush=True)
                    continue
            
            # Create a function for this tool
            tool_function = create_mcp_tool_function(
                tool_name=tool.name,
                tool_description=tool.description or f"MCP tool: {tool.name}",
                tool_schema=tool.input_schema if hasattr(tool, 'input_schema') else {},
                mcp_client=self.mcp_client
            )
            
            tools.append(tool_function)
        
        logger.info(f"Created {len(tools)} Agno-compatible tool functions")
        return tools
    
    async def process_message(self, message: str, conversation_id: str, phone_number: str) -> str:
        """Process an incoming SMS message and return response"""
        
        # Get conversation history
        history = await self._get_conversation_history(conversation_id)
        
        # Create session context
        session_data = {
            "conversation_id": conversation_id,
            "phone_number": phone_number,
            "timestamp": datetime.utcnow().isoformat()
        }
        
        # Run the agent (async method since we have async tools)
        response = await self.agent.arun(message=message, messages=history, stream=False)
        
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