#!/usr/bin/env python3
"""
Agno-based Python Worker for SMS message processing
Uses Agno framework for agent orchestration and MCP for tool execution
"""
print("WORKER STARTING - python_worker_agno.py", flush=True)

import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

# Add agents directory to path
agents_path = os.path.join(os.path.dirname(__file__), 'src', 'agents')
sys.path.append(agents_path)

from sms_agent_agno_mcp import create_agno_mcp_agent
# Fallback agents
from sms_agent_functional import create_sms_agent
from sms_agent_simple import SimpleSMSAgent, create_sms_agent as create_simple_sms_agent

# Try to import morning update
try:
    from morning_update import MorningUpdateManager
    MORNING_UPDATE_AVAILABLE = True
    logging.info(f"Morning update module loaded successfully from {agents_path}")
except ImportError as e:
    MORNING_UPDATE_AVAILABLE = False
    logging.warning(f"Morning update module not available: {e}")

# Load environment variables
load_dotenv()

# Configure logging
import sys

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)

# Suppress noisy loggers
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
logging.getLogger('hpack').setLevel(logging.WARNING)
logging.getLogger('agno').setLevel(logging.INFO)


class AgnoWorker:
    """Worker that uses Agno agents to process messages"""
    
    def __init__(self):
        # Initialize Supabase client
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
        
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
        
        # MCP server configuration
        # Use the deployed MCP server on Heroku
        self.mcp_server_url = os.getenv("MCP_SERVER_URL", "https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com")
        
        # Agent instances cached by profile_id
        self.agents = {}
        
        # Morning update manager
        self.morning_update_manager = None
    
    async def initialize_agent(self, profile_id: Optional[str] = None):
        """Initialize the Agno agent for a specific profile"""
        # REMOVED CACHING - Create fresh agent every time to ensure latest tools
        print(f"CREATING NEW AGENT FOR PROFILE: {profile_id}", flush=True)
        logger.info(f"Initializing Agno SMS agent for profile: {profile_id or 'default'}")
        
        # Get database URL for session storage
        db_url = os.getenv('DATABASE_URL')
        
        # Create Agno agent with MCP support - no fallback
        agent = await create_agno_mcp_agent(self.supabase, self.mcp_server_url, profile_id, db_url)
        logger.info(f"Agno MCP agent initialized successfully for profile: {profile_id or 'default'}")
        
        # Log available tools if MCP is connected
        if hasattr(agent, 'mcp_tools') and agent.mcp_tools:
            # Check functions dict for Toolkit pattern
            tool_count = len(agent.mcp_tools.functions) if hasattr(agent.mcp_tools, 'functions') else 0
            print(f"AGENT HAS MCP TOOLS: {tool_count} tools", flush=True)
            logger.info(f"MCP connected with {tool_count} tools available for profile {profile_id or 'default'}")
            
            # Log tool names for debugging
            if tool_count > 0:
                tool_names = list(agent.mcp_tools.functions.keys())
                logger.info(f"Available tools: {', '.join(tool_names)}")
            
            if tool_count == 0:
                raise Exception("No tools loaded from MCP server!")
        else:
            raise Exception("Agent has no MCP tools!")
        
        # Note: Not caching the agent anymore
        
        # Initialize morning update manager if available (only once)
        if MORNING_UPDATE_AVAILABLE and not self.morning_update_manager:
                if hasattr(agent, 'mcp_client'):
                    self.morning_update_manager = MorningUpdateManager(self.supabase, agent.mcp_client)
                    logger.info("Morning update manager initialized")
        
        # Return the newly created agent
        return agent
    
    async def process_pending_jobs(self):
        """Process pending conversation jobs"""
        try:
            # Check for morning update jobs first
            if self.morning_update_manager:
                morning_jobs = self.supabase.table('conversation_jobs').select('*').eq(
                    'job_type', 'morning_update'
                ).eq('status', 'pending').execute()
                
                if morning_jobs.data:
                    for job in morning_jobs.data:
                        await self._process_morning_update_job(job)
            
            # Get pending regular jobs
            result = self.supabase.table('conversation_jobs').select('*').eq(
                'status', 'pending'
            ).eq('job_type', 'message').order('created_at').limit(10).execute()
            
            if not result.data:
                return
            
            print(f"FOUND {len(result.data)} PENDING JOBS", flush=True)
            logger.info(f"Found {len(result.data)} pending message jobs")
            
            # Process each job
            for job in result.data:
                await self._process_job(job)
                
        except Exception as e:
            logger.error(f"Error processing pending jobs: {e}", exc_info=True)
    
    async def _process_job(self, job: Dict[str, Any]):
        """Process a single job"""
        job_id = job['id']
        print(f"PROCESSING JOB {job_id}", flush=True)
        
        try:
            # Update job status to processing
            self.supabase.table('conversation_jobs').update({
                'status': 'processing',
                'started_at': datetime.now(timezone.utc).isoformat()
            }).eq('id', job_id).execute()
            
            # Get the message details
            message_result = self.supabase.table('conversation_messages').select('*').eq(
                'id', job['message_id']
            ).single().execute()
            
            if not message_result.data:
                raise ValueError(f"Message {job['message_id']} not found")
            
            message = message_result.data
            
            # Log message details
            profile_id = message.get('profile_id')
            
            # Debug profile_id
            print(f"RAW PROFILE_ID FROM MESSAGE: {repr(profile_id)} (type: {type(profile_id).__name__})", flush=True)
            
            # Initialize agent for this profile if needed
            print(f"INITIALIZING AGENT FOR PROFILE: {profile_id}", flush=True)
            agent = await self.initialize_agent(profile_id)
            
            # Process the message with Agno agent
            print(f"PROCESSING MESSAGE: {message['content'][:50]}", flush=True)
            logger.info(f"Processing message from {message.get('phone_number')} with profile {profile_id}: {message['content'][:50]}...")
            
            response = await agent.process_message(
                message=message['content'],
                conversation_id=message['conversation_id'],
                phone_number=message['phone_number']
            )
            
            print(f"AGENT RESPONSE: {response[:100]}", flush=True)
            logger.info(f"Agent response: {response[:100]}...")
            
            # Send SMS response
            await self._send_sms_response(
                phone_number=message['phone_number'],
                content=response,
                conversation_id=message['conversation_id'],
                profile_id=message['profile_id']
            )
            
            # Update job status to completed
            self.supabase.table('conversation_jobs').update({
                'status': 'completed',
                'completed_at': datetime.now(timezone.utc).isoformat(),
                'result': {'response': response}
            }).eq('id', job_id).execute()
            
            logger.info(f"Job {job_id} completed successfully")
            
        except Exception as e:
            logger.error(f"Error processing job {job_id}: {e}", exc_info=True)
            
            # Update job status to failed
            self.supabase.table('conversation_jobs').update({
                'status': 'failed',
                'completed_at': datetime.now(timezone.utc).isoformat(),
                'error': str(e)
            }).eq('id', job_id).execute()
    
    async def _process_morning_update_job(self, job: Dict[str, Any]):
        """Process a morning update job"""
        job_id = job['id']
        
        try:
            # Update job status
            self.supabase.table('conversation_jobs').update({
                'status': 'processing',
                'started_at': datetime.now(timezone.utc).isoformat()
            }).eq('id', job_id).execute()
            
            # Process morning update
            phone_number = job['metadata'].get('phone_number')
            if phone_number and self.morning_update_manager:
                update_sent = await self.morning_update_manager.send_morning_update(phone_number)
                
                if update_sent:
                    self.supabase.table('conversation_jobs').update({
                        'status': 'completed',
                        'completed_at': datetime.now(timezone.utc).isoformat()
                    }).eq('id', job_id).execute()
                else:
                    raise Exception("Failed to send morning update")
            else:
                raise ValueError("Missing phone number or morning update manager")
                
        except Exception as e:
            logger.error(f"Error processing morning update job {job_id}: {e}", exc_info=True)
            self.supabase.table('conversation_jobs').update({
                'status': 'failed',
                'completed_at': datetime.now(timezone.utc).isoformat(),
                'error': str(e)
            }).eq('id', job_id).execute()
    
    async def _send_sms_response(self, phone_number: str, content: str, conversation_id: str, profile_id: str):
        """Send SMS response and store in database"""
        try:
            # Store the outgoing message
            message_result = self.supabase.table('conversation_messages').insert({
                'profile_id': profile_id,
                'conversation_id': conversation_id,
                'phone_number': phone_number,
                'content': content,
                'direction': 'outgoing',
                'status': 'pending'
            }).execute()
            
            if not message_result.data:
                raise ValueError("Failed to store outgoing message")
            
            message_id = message_result.data[0]['id']
            
            # Use Supabase Edge Function to send SMS (like the server does)
            # Note: The Python SDK returns the response data directly as bytes
            try:
                result = await asyncio.to_thread(
                    self.supabase.functions.invoke,
                    'send-sms',
                    {'body': {
                        'to': phone_number,
                        'message': content
                    }}
                )
                
                # The Python SDK returns bytes, we need to decode and check for success
                # If the function executed successfully, we assume the SMS was sent
                logger.info(f"SMS function invoked for {phone_number}")
                
                # Update message status to completed (sent successfully)
                self.supabase.table('conversation_messages').update({
                    'status': 'completed',
                    'sent_at': datetime.now(timezone.utc).isoformat()
                }).eq('id', message_id).execute()
                
                logger.info(f"SMS sent successfully to {phone_number}")
                
            except Exception as sms_error:
                logger.error(f"Failed to send SMS: {sms_error}")
                # Update message status to failed
                self.supabase.table('conversation_messages').update({
                    'status': 'failed',
                    'error': f"SMS send failed: {str(sms_error)}"
                }).eq('id', message_id).execute()
                
        except Exception as e:
            logger.error(f"Error sending SMS response: {e}", exc_info=True)
            raise
    
    async def run(self):
        """Main worker loop"""
        logger.info(f"Starting Agno worker with MCP URL: {self.mcp_server_url}")
        
        loop_count = 0
        while True:
            try:
                loop_count += 1
                if loop_count % 30 == 1:  # Log every 60 seconds (30 * 2 second sleep)
                    print(f"Worker alive - loop {loop_count}", flush=True)
                
                # Process pending jobs
                await self.process_pending_jobs()
                
                # Sleep for a bit
                await asyncio.sleep(2)
                
            except KeyboardInterrupt:
                logger.info("Worker stopped by user")
                break
            except Exception as e:
                logger.error(f"Worker error: {e}", exc_info=True)
                await asyncio.sleep(5)
        
        # Cleanup all agents
        for agent in self.agents.values():
            await agent.cleanup()


async def main():
    """Main entry point"""
    worker = AgnoWorker()
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())