"""
SMS Agent using Agno with proper MCP integration
"""

import os
import logging
import time
import asyncio
from typing import Dict, List, Any, Optional
from datetime import datetime

from agno.agent import Agent
from agno.models.anthropic import Claude
from agno.knowledge.url import UrlKnowledge
from agno.storage.postgres import PostgresStorage
from supabase import Client as SupabaseClient

# Import our custom MCP tools integration
try:
    from .agno_mcp_tools import create_http_mcp_tools
except ImportError:
    from agno_mcp_tools import create_http_mcp_tools

logger = logging.getLogger(__name__)


class AgnoMCPSMSAgent:
    """Agent for handling SMS messages using Agno and MCP"""
    
    def __init__(self, supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None):
        self.supabase = supabase_client
        self.mcp_server_url = mcp_server_url
        self.profile_id = profile_id
        self.mcp_tools = None
        self.agent = None
        self.storage = None
        self.db_url = None  # Will be set from environment or config
        
        # Rate limiting protection
        self._last_request_time = 0
        self._min_request_interval = 0.5  # 500ms between requests to avoid bursts
        
    async def initialize(self):
        """Initialize the agent with MCP tools"""
        try:
            # Initialize MCP tools connection
            logger.info(f"Connecting to MCP server at {self.mcp_server_url}")
            self.mcp_tools = await create_http_mcp_tools(
                self.mcp_server_url,
                self.profile_id
            )
            
            
            # Load OCTO API documentation as URL knowledge
            logger.info("Adding OCTO API documentation as URL knowledge")
            octo_docs = UrlKnowledge(url="https://docs.octo.travel/")
            knowledge = [octo_docs]
            
            # Initialize storage if database URL is available
            if not self.db_url:
                # Get database URL from environment or use Supabase connection
                self.db_url = os.getenv('DATABASE_URL')
                if not self.db_url:
                    logger.warning("No DATABASE_URL found, agent will run without session storage")
            
            if self.db_url:
                logger.info(f"Initializing Postgres storage for profile: {self.profile_id}")
                self.storage = PostgresStorage(
                    table_name="agent_sessions",
                    db_url=self.db_url,
                    auto_upgrade_schema=True  # Enable automatic schema upgrades
                )
            
            # Create Agno agent with MCP tools, knowledge, and storage
            self.agent = Agent(
                model=Claude(id="claude-3-5-haiku-20241022"),  # Using Haiku for better rate limits
                tools=[self.mcp_tools],  # MCP tools only
                instructions="""SMS assistant for Adventure Harmony. Help with bookings, weather, calendar, and destinations.
                
                OCTO BOOKING FLOW (MUST FOLLOW IN ORDER):
                
                REQUIRED HEADER FOR ALL CALLS: Octo-Capabilities: octo/content
                
                1. GET /products - Find tours and save exact IDs
                   - Save productId: "20ef1799-7020-484b-9fb5-905ec5bb5444"
                   - Save optionId: "DEFAULT" (from product.options[].id)
                   - Save unit IDs: "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"
                   - NEVER use generic IDs like "adult" - use the complete UUID
                   
                2. POST /availability - Check dates and get availability ID
                   Request format:
                   {
                     "productId": "[exact productId from step 1]",
                     "optionId": "[exact optionId from step 1]",
                     "localDateStart": "2024-06-15",
                     "localDateEnd": "2024-06-15",
                     "units": [{"id": "[exact unit ID from step 1]", "quantity": 2}]
                   }
                   
                   CRITICAL: The response 'id' field IS your availabilityId!
                   Example response: {"id": "2024-06-15", "available": true}
                   Save this 'id' value as availabilityId for booking!
                   
                3. POST /bookings - Create the booking (ADAPTIVE APPROACH)
                   
                   TRY THIS STRUCTURE FIRST:
                   {
                     "productId": "[from step 1]",
                     "optionId": "[from step 1]",
                     "localDate": "2024-06-15",
                     "availabilityId": "2024-06-15",  // The 'id' from step 2!
                     "contact": {
                       "fullName": "John Doe",
                       "emailAddress": "john@example.com",
                       "phoneNumber": "+12125551234"
                     },
                     "units": [{
                       "id": "[exact unit ID from step 1]",
                       "quantity": 2,
                       "tickets": [{}, {}]  // Empty objects matching quantity
                     }]
                   }
                   
                   IF YOU GET "tickets required" ERROR, TRY:
                   {
                     "units": [{
                       "id": "[exact unit ID]",
                       "quantity": 2,
                       "tickets": [
                         {"unitId": "[exact unit ID]"},
                         {"unitId": "[exact unit ID]"}
                       ]
                     }]
                   }
                   
                   IF STILL FAILING, TRY WITHOUT TICKETS:
                   {
                     "units": [{
                       "id": "[exact unit ID]",
                       "quantity": 2
                     }]
                   }
                
                CRITICAL MISTAKES TO AVOID:
                - DON'T make up IDs - use exact values from API responses
                - DON'T use object format for units - ALWAYS use array
                - DON'T skip steps - you MUST get products first, then availability, then book
                
                ERROR HANDLING:
                - If booking fails with "tickets required", try different ticket structures
                - If all attempts fail, tell user: "I'm having trouble with the booking system. Please try booking directly at [supplier website] or call them."
                - Always log the exact error for debugging
                
                SMS RESPONSE LIMITS:
                - ALL responses MUST be under 1600 characters (SMS limit)
                - Be concise and friendly
                - Use short sentences and abbreviations when needed
                - For long lists, show only the most relevant 2-3 items
                - Say "Text 'more' for additional options" if truncating
                
                Keep responses brief and within the 1600 character limit.""",
                knowledge=knowledge,
                storage=self.storage,
                session_id=self.profile_id or "default",
                markdown=True,
                # Conversation history settings
                add_history_to_messages=True,  # Include previous messages in context
                num_history_runs=3,  # Reduced to 3 exchanges to save tokens
                # Optional: Enable if you want agent to search older conversations
                # search_previous_sessions_history=True,
                # num_history_sessions=2
            )
            
            # Count total tools
            mcp_tool_count = len(self.mcp_tools.functions) if hasattr(self.mcp_tools, 'functions') else 0
            
            logger.info(f"Agno agent created with {mcp_tool_count} MCP tools, {len(knowledge)} knowledge sources, and {'session storage' if self.storage else 'no storage'}")
            
        except Exception as e:
            logger.error(f"Failed to initialize MCP tools: {e}")
            raise
            
    async def process_message(self, message: str, conversation_id: str, phone_number: str) -> str:
        """Process an incoming SMS message and return response"""
        
        # Rate limiting protection
        current_time = time.time()
        time_since_last = current_time - self._last_request_time
        if time_since_last < self._min_request_interval:
            await asyncio.sleep(self._min_request_interval - time_since_last)
        
        self._last_request_time = time.time()
        
        # Log API call for monitoring
        logger.info(f"API call for profile {self.profile_id} at {datetime.now()}")
        
        # Run the agent with async method
        # With add_history_to_messages=True, the agent automatically includes history
        try:
            response = await self.agent.arun(
                message=message,
                stream=False
            )
        except Exception as e:
            if "rate_limit" in str(e).lower():
                logger.warning(f"Rate limit hit for profile {self.profile_id}: {e}")
                # Could implement fallback logic here
            raise
        
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
async def create_agno_mcp_agent(supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None, db_url: Optional[str] = None) -> AgnoMCPSMSAgent:
    """Create and initialize Agno MCP SMS agent"""
    agent = AgnoMCPSMSAgent(supabase_client, mcp_server_url, profile_id)
    if db_url:
        agent.db_url = db_url
    await agent.initialize()
    return agent