"""
SMS Agent using Agno with proper MCP integration
"""

import os
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime

from agno.agent import Agent
from agno.models.anthropic import Claude
from supabase import Client as SupabaseClient

# Import our custom MCP client
try:
    from .agno_mcp_http_client import create_mcp_http_client, MCPTool
except ImportError:
    from agno_mcp_http_client import create_mcp_http_client, MCPTool

logger = logging.getLogger(__name__)


class AgnoMCPSMSAgent:
    """Agent for handling SMS messages using Agno and MCP"""
    
    def __init__(self, supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None):
        self.supabase = supabase_client
        self.mcp_server_url = mcp_server_url
        self.profile_id = profile_id
        self.mcp_client = None
        self.agent = None
        
    async def initialize(self):
        """Initialize the agent with MCP tools"""
        try:
            # Initialize MCP tools connection
            logger.info(f"Connecting to MCP server at {self.mcp_server_url}")
            self.mcp_tools = await create_http_mcp_tools(
                self.mcp_server_url,
                self.profile_id
            )
            
            # Create Agno agent with MCP tools
            self.agent = Agent(
                model=Claude(id="claude-3-5-sonnet-20241022"),
                tools=[self.mcp_tools],  # Pass MCP tools object directly
                instructions="""You are a helpful SMS assistant for Adventure Harmony Planner.
                You help users with:
                - Booking tours, activities, and rentals
                - Checking weather information
                - Managing their calendar
                - Answering questions about destinations
                
                Always be concise and friendly. Remember that responses will be sent via SMS,
                so keep them brief and to the point.
                
                You have access to various tools for searching activities, making bookings,
                checking weather, and managing calendars.""",
                markdown=True
            )
            
            logger.info(f"Agno agent created with MCP tools")
            
        except Exception as e:
            logger.error(f"Failed to initialize MCP tools: {e}")
            raise
            
    async def process_message(self, message: str, conversation_id: str, phone_number: str) -> str:
        """Process an incoming SMS message and return response"""
        
        # Get conversation history
        history = await self._get_conversation_history(conversation_id)
        
        # Run the agent with async method
        response = await self.agent.arun(
            message=message,
            messages=history,
            stream=False
        )
        
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
            logger.error(f"Error getting conversation history: {e}")
            return []
    
    async def cleanup(self):
        """Clean up resources"""
        # MCP tools cleanup is handled by context manager
        pass


# Factory function to create agent
async def create_agno_mcp_agent(supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None) -> AgnoMCPSMSAgent:
    """Create and initialize Agno MCP SMS agent"""
    agent = AgnoMCPSMSAgent(supabase_client, mcp_server_url, profile_id)
    await agent.initialize()
    return agent