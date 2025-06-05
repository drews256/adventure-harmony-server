"""
Simple SMS Agent using direct Anthropic API (no MCP integration)

This is a fallback agent that can process messages without MCP tools.
Used when MCP server is unavailable or during development.
"""

import os
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime

from anthropic import AsyncAnthropic
from supabase import Client as SupabaseClient

logger = logging.getLogger(__name__)


class SimpleSMSAgent:
    """Simple agent for handling SMS messages using Anthropic directly"""
    
    def __init__(self, supabase_client: SupabaseClient, mcp_server_url: str = None):
        self.supabase = supabase_client
        self.mcp_server_url = mcp_server_url
        self.anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        
    async def initialize(self):
        """Initialize the agent (no-op for simple agent)"""
        logger.info("Simple SMS agent initialized (no MCP tools)")
        
    async def process_message(self, message: str, conversation_id: str, phone_number: str) -> str:
        """Process an incoming SMS message and return response"""
        
        # Get conversation history
        history = await self._get_conversation_history(conversation_id)
        
        # Build messages for Claude
        messages = []
        
        # Add conversation history
        for msg in history:
            messages.append({
                'role': msg['role'],
                'content': msg['content']
            })
        
        # Add current message
        messages.append({
            'role': 'user',
            'content': message
        })
        
        # Call Claude API directly
        try:
            response = await self.anthropic.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=1024,
                system="""You are a helpful SMS assistant for Adventure Harmony Planner.
                You help users with:
                - Booking tours, activities, and rentals
                - Checking weather information  
                - Managing their calendar
                - Answering questions about destinations
                
                Always be concise and friendly. Remember that responses will be sent via SMS,
                so keep them brief and to the point.
                
                Since you don't have access to tools, you should:
                - Politely explain that you cannot perform specific actions like booking or checking weather
                - Offer to provide general information or guidance
                - Suggest they visit the website or app for full functionality""",
                messages=messages
            )
            
            return response.content[0].text
            
        except Exception as e:
            logger.error(f"Error calling Claude API: {e}")
            return "I'm sorry, I'm having trouble processing your request right now. Please try again later."
    
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
            
            # Convert to format expected by Claude
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
        """Clean up resources (no-op for simple agent)"""
        pass


# Factory function to create agent
async def create_sms_agent(supabase_client: SupabaseClient, mcp_server_url: str = None) -> SimpleSMSAgent:
    """Create and initialize simple SMS agent"""
    agent = SimpleSMSAgent(supabase_client, mcp_server_url)
    await agent.initialize()
    return agent