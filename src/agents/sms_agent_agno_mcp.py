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
    from .local_tools import create_local_tools
    from .octo_helper_tools import create_octo_helper_tools
except ImportError:
    from agno_mcp_tools import create_http_mcp_tools
    from local_tools import create_local_tools
    from octo_helper_tools import create_octo_helper_tools

logger = logging.getLogger(__name__)


class AgnoMCPSMSAgent:
    """Agent for handling SMS messages using Agno and MCP"""
    
    def __init__(self, supabase_client: SupabaseClient, mcp_server_url: str, profile_id: Optional[str] = None):
        self.supabase = supabase_client
        self.mcp_server_url = mcp_server_url
        self.profile_id = profile_id
        self.mcp_tools = None
        self.local_tools = None
        self.octo_helper_tools = None
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
            
            # Initialize local tools (forms, calendar, SMS, help)
            logger.info("Initializing local tools")
            self.local_tools = create_local_tools(self.supabase)
            
            # Initialize OCTO helper tools
            logger.info("Initializing OCTO helper tools")
            self.octo_helper_tools = create_octo_helper_tools()
            
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
                tools=[self.octo_helper_tools, self.local_tools, self.mcp_tools],  # Helper tools first
                instructions="""SMS assistant for Adventure Harmony. Help with bookings, weather, calendar, and destinations.
                
                BOOKING FLOW - USE HELPER TOOLS:
                1. Search products (GET /products), then use parse_products_for_booking to extract IDs
                2. Use format_availability_request to create proper availability check
                3. Use format_booking_request to create booking from availability response
                
                HELPER TOOLS AVAILABLE:
                - parse_products_for_booking: Extract product/option/unit IDs from search
                - format_availability_request: Create proper availability check with units array
                - format_booking_request: Create booking using availability response
                - get_unit_ids_for_product: Look up unit IDs for a product
                
                Be concise and friendly. Keep responses brief for SMS format.""",
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
            local_tool_count = len(self.local_tools.functions) if hasattr(self.local_tools, 'functions') else 0
            octo_helper_count = len(self.octo_helper_tools.functions) if hasattr(self.octo_helper_tools, 'functions') else 0
            total_tools = mcp_tool_count + local_tool_count + octo_helper_count
            
            logger.info(f"Agno agent created with {total_tools} tools ({octo_helper_count} OCTO helpers, {local_tool_count} local utility, {mcp_tool_count} MCP), {len(knowledge)} knowledge sources, and {'session storage' if self.storage else 'no storage'}")
            
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