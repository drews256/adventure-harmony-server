#!/usr/bin/env python3
"""
Python Worker for Message Analysis Server
Processes messages using Claude AI and executes tools via MCP
"""

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from anthropic import Anthropic
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', '5'))
MAX_RETRIES = 3
RETRY_DELAY = 2

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)


@dataclass
class Message:
    """Represents a conversation message"""
    id: str
    conversation_id: str
    content: str
    from_number: str
    to_number: str
    direction: str
    status: str
    metadata: Optional[Dict[str, Any]] = None
    thread_id: Optional[str] = None
    created_at: Optional[str] = None


@dataclass
class ToolCall:
    """Represents a tool call from Claude"""
    id: str
    name: str
    input: Dict[str, Any]


class LocalTool:
    """Base class for local tools"""
    
    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the tool with given parameters"""
        raise NotImplementedError


class CalendarTool(LocalTool):
    """Calendar display tool"""
    
    def __init__(self):
        super().__init__(
            name="calendar_display",
            description="Displays a calendar interface"
        )
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        # Simplified calendar response
        return {
            "type": "calendar",
            "data": params,
            "rendered": f"Calendar for {params.get('year', datetime.now().year)}-{params.get('month', datetime.now().month)}"
        }


class FormTool(LocalTool):
    """Dynamic form generation tool"""
    
    def __init__(self):
        super().__init__(
            name="dynamic_form",
            description="Creates dynamic forms for user input"
        )
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        # Store form in database
        form_data = {
            "conversation_id": context.get("conversation_id"),
            "title": params.get("title", "Form"),
            "fields": json.dumps(params.get("fields", [])),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        result = supabase.table("dynamic_forms").insert(form_data).execute()
        form_id = result.data[0]["id"]
        
        return {
            "type": "form",
            "form_id": form_id,
            "url": f"http://localhost:3000/api/forms/{form_id}",
            "message": f"Please fill out the form: {params.get('title', 'Form')}"
        }


class SMSTool(LocalTool):
    """SMS sending tool"""
    
    def __init__(self):
        super().__init__(
            name="sms_send",
            description="Sends SMS messages"
        )
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        # In production, this would integrate with an SMS service
        return {
            "type": "sms",
            "status": "sent",
            "message": f"SMS sent to {params.get('to_number', 'unknown')}"
        }


class HelpTool(LocalTool):
    """Help request tool"""
    
    def __init__(self):
        super().__init__(
            name="help_request",
            description="Records help requests"
        )
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        # Store help request in database
        help_data = {
            "conversation_id": context.get("conversation_id"),
            "category": params.get("category", "general"),
            "urgency": params.get("urgency", "medium"),
            "description": params.get("description", ""),
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        result = supabase.table("help_requests").insert(help_data).execute()
        
        return {
            "type": "help",
            "status": "recorded",
            "message": "Your help request has been recorded and will be addressed soon."
        }


class MessageProcessor:
    """Handles message processing with Claude and tools"""
    
    def __init__(self):
        self.local_tools = {
            "calendar_display": CalendarTool(),
            "dynamic_form": FormTool(),
            "sms_send": SMSTool(),
            "help_request": HelpTool()
        }
        self.mcp_session: Optional[ClientSession] = None
    
    async def connect_to_mcp(self) -> Optional[ClientSession]:
        """Connect to MCP server"""
        try:
            server_params = StdioServerParameters(
                command="npx",
                args=["-y", "@modelcontextprotocol/server-everything"]
            )
            
            async with stdio_client(server_params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    self.mcp_session = session
                    logger.info("Connected to MCP server")
                    return session
        except Exception as e:
            logger.error(f"Failed to connect to MCP: {e}")
            return None
    
    async def get_conversation_history(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Fetch conversation history from database"""
        try:
            result = supabase.table("conversation_messages") \
                .select("*") \
                .eq("conversation_id", conversation_id) \
                .order("created_at", desc=False) \
                .execute()
            
            messages = []
            for msg in result.data:
                # Build Claude-compatible message format
                role = "user" if msg["direction"] == "incoming" else "assistant"
                content = msg["content"]
                
                # Handle tool results
                if msg.get("metadata", {}).get("tool_use_id"):
                    content = [{
                        "type": "tool_result",
                        "tool_use_id": msg["metadata"]["tool_use_id"],
                        "content": json.dumps(msg["metadata"].get("tool_result", {}))
                    }]
                
                messages.append({
                    "role": role,
                    "content": content
                })
            
            return messages
        except Exception as e:
            logger.error(f"Error fetching conversation history: {e}")
            return []
    
    def filter_tools(self, message_content: str) -> List[str]:
        """Filter tools based on message content"""
        tools = []
        
        # Simple keyword-based filtering
        content_lower = message_content.lower()
        
        if any(word in content_lower for word in ["calendar", "schedule", "date", "appointment"]):
            tools.append("calendar_display")
        
        if any(word in content_lower for word in ["form", "input", "fill", "submit"]):
            tools.append("dynamic_form")
        
        if any(word in content_lower for word in ["help", "assist", "support", "problem"]):
            tools.append("help_request")
        
        # Always include SMS tool
        tools.append("sms_send")
        
        return tools
    
    async def call_claude(self, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Call Claude API with messages and tools"""
        try:
            response = anthropic.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4096,
                messages=messages,
                tools=tools if tools else None,
                system="You are a helpful assistant analyzing messages and determining appropriate actions."
            )
            
            return {
                "content": response.content,
                "stop_reason": response.stop_reason,
                "usage": response.usage.dict() if response.usage else {}
            }
        except Exception as e:
            logger.error(f"Error calling Claude: {e}")
            raise
    
    async def execute_tool_call(self, tool_call: ToolCall, context: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool call"""
        try:
            # Check if it's a local tool
            if tool_call.name in self.local_tools:
                result = await self.local_tools[tool_call.name].execute(tool_call.input, context)
                return {"success": True, "result": result}
            
            # Try MCP tools
            if self.mcp_session:
                result = await self.mcp_session.call_tool(tool_call.name, tool_call.input)
                return {"success": True, "result": result}
            
            return {"success": False, "error": f"Tool {tool_call.name} not found"}
        except Exception as e:
            logger.error(f"Error executing tool {tool_call.name}: {e}")
            return {"success": False, "error": str(e)}
    
    async def process_message(self, message: Message) -> Tuple[str, Optional[Dict[str, Any]]]:
        """Process a single message"""
        try:
            # Update status to processing
            supabase.table("conversation_messages") \
                .update({"status": "processing"}) \
                .eq("id", message.id) \
                .execute()
            
            # Get conversation history
            history = await self.get_conversation_history(message.conversation_id)
            
            # Add current message to history
            history.append({
                "role": "user",
                "content": message.content
            })
            
            # Filter relevant tools
            tool_names = self.filter_tools(message.content)
            tools = []
            
            # Build tool definitions
            for name in tool_names:
                if name in self.local_tools:
                    tool = self.local_tools[name]
                    tools.append({
                        "name": name,
                        "description": tool.description,
                        "input_schema": {
                            "type": "object",
                            "properties": {}  # Simplified schema
                        }
                    })
            
            # Call Claude
            response = await self.call_claude(history, tools)
            
            # Process response
            text_response = ""
            tool_results = []
            
            for content in response["content"]:
                if content.type == "text":
                    text_response += content.text
                elif content.type == "tool_use":
                    tool_call = ToolCall(
                        id=content.id,
                        name=content.name,
                        input=content.input
                    )
                    
                    # Execute tool
                    result = await self.execute_tool_call(tool_call, {
                        "conversation_id": message.conversation_id,
                        "from_number": message.from_number
                    })
                    
                    tool_results.append({
                        "tool_use_id": content.id,
                        "result": result
                    })
            
            # If we have tool results, make a follow-up call to Claude
            if tool_results:
                # Add tool results to history
                history.append({
                    "role": "assistant",
                    "content": response["content"]
                })
                
                # Add tool results
                for result in tool_results:
                    history.append({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": result["tool_use_id"],
                            "content": json.dumps(result["result"])
                        }]
                    })
                
                # Call Claude again
                follow_up = await self.call_claude(history, [])
                
                # Extract final text response
                for content in follow_up["content"]:
                    if content.type == "text":
                        text_response = content.text
                        break
            
            metadata = {
                "tool_results": tool_results,
                "usage": response.get("usage", {})
            }
            
            return text_response, metadata
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            raise


class Worker:
    """Main worker class"""
    
    def __init__(self):
        self.processor = MessageProcessor()
        self.running = True
    
    async def get_pending_message(self) -> Optional[Message]:
        """Fetch a pending message from the database"""
        try:
            result = supabase.table("conversation_messages") \
                .select("*") \
                .eq("direction", "incoming") \
                .eq("status", "pending") \
                .order("created_at", desc=False) \
                .limit(1) \
                .execute()
            
            if result.data:
                data = result.data[0]
                return Message(
                    id=data["id"],
                    conversation_id=data["conversation_id"],
                    content=data["content"],
                    from_number=data["from_number"],
                    to_number=data["to_number"],
                    direction=data["direction"],
                    status=data["status"],
                    metadata=data.get("metadata"),
                    thread_id=data.get("thread_id"),
                    created_at=data.get("created_at")
                )
            
            return None
        except Exception as e:
            logger.error(f"Error fetching pending message: {e}")
            return None
    
    async def save_response(self, message: Message, response: str, metadata: Optional[Dict[str, Any]] = None):
        """Save response to database"""
        try:
            response_data = {
                "conversation_id": message.conversation_id,
                "content": response,
                "from_number": message.to_number,
                "to_number": message.from_number,
                "direction": "outgoing",
                "status": "completed",
                "metadata": metadata or {},
                "thread_id": message.thread_id,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            supabase.table("conversation_messages").insert(response_data).execute()
            
            # Update original message status
            supabase.table("conversation_messages") \
                .update({"status": "completed"}) \
                .eq("id", message.id) \
                .execute()
            
            logger.info(f"Saved response for message {message.id}")
            
        except Exception as e:
            logger.error(f"Error saving response: {e}")
            raise
    
    async def send_sms(self, to_number: str, content: str):
        """Send SMS (placeholder - integrate with actual SMS service)"""
        logger.info(f"Sending SMS to {to_number}: {content}")
        # In production, integrate with Twilio or similar service
    
    async def process_loop(self):
        """Main processing loop"""
        logger.info("Worker started, polling for messages...")
        
        while self.running:
            try:
                # Get pending message
                message = await self.get_pending_message()
                
                if message:
                    logger.info(f"Processing message {message.id}")
                    
                    try:
                        # Process message
                        response, metadata = await self.processor.process_message(message)
                        
                        # Save response
                        await self.save_response(message, response, metadata)
                        
                        # Send SMS
                        await self.send_sms(message.from_number, response)
                        
                    except Exception as e:
                        logger.error(f"Error processing message {message.id}: {e}")
                        
                        # Update status to failed
                        supabase.table("conversation_messages") \
                            .update({"status": "failed", "metadata": {"error": str(e)}}) \
                            .eq("id", message.id) \
                            .execute()
                
                # Wait before next poll
                await asyncio.sleep(POLL_INTERVAL)
                
            except Exception as e:
                logger.error(f"Error in process loop: {e}")
                await asyncio.sleep(POLL_INTERVAL)
    
    def stop(self):
        """Stop the worker"""
        self.running = False


async def main():
    """Main entry point"""
    worker = Worker()
    
    try:
        await worker.process_loop()
    except KeyboardInterrupt:
        logger.info("Received interrupt, shutting down...")
        worker.stop()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())