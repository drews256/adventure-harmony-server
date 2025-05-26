#!/usr/bin/env python3
"""
A2A Protocol-compliant Python Worker for Message Analysis Server
Uses Google's A2A protocol for agent communication
"""

import asyncio
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union
from enum import Enum

import httpx
from anthropic import Anthropic
from dotenv import load_dotenv
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

# A2A Configuration
A2A_AGENT_ID = os.getenv('A2A_AGENT_ID', 'message-analysis-agent')
A2A_AGENT_NAME = os.getenv('A2A_AGENT_NAME', 'Message Analysis Agent')
A2A_AGENT_VERSION = '1.0.0'

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)


class A2AMessageType(Enum):
    """A2A message types"""
    REQUEST = "request"
    RESPONSE = "response"
    NOTIFICATION = "notification"
    ERROR = "error"


@dataclass
class A2AMessage:
    """A2A Protocol Message"""
    jsonrpc: str = "2.0"
    id: Optional[str] = None
    method: Optional[str] = None
    params: Optional[Dict[str, Any]] = None
    result: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary, excluding None values"""
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class A2ATool:
    """A2A Tool Definition"""
    name: str
    description: str
    input_schema: Dict[str, Any]
    output_schema: Optional[Dict[str, Any]] = None
    
    def to_agent_card_format(self) -> Dict[str, Any]:
        """Convert to Agent Card tool format"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_schema,
            "returns": self.output_schema or {"type": "object"}
        }


class A2AAgentCard:
    """A2A Agent Card for capability discovery"""
    
    def __init__(self, agent_id: str, name: str, version: str):
        self.agent_id = agent_id
        self.name = name
        self.version = version
        self.capabilities = []
        self.tools = []
        self.interaction_modes = ["synchronous", "streaming"]
        self.description = "AI agent for message analysis and task execution"
    
    def add_tool(self, tool: A2ATool):
        """Add a tool to the agent card"""
        self.tools.append(tool)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "capabilities": self.capabilities,
            "tools": [tool.to_agent_card_format() for tool in self.tools],
            "interaction_modes": self.interaction_modes,
            "metadata": {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "protocol_version": "1.0"
            }
        }


class A2ALocalTool:
    """Base class for A2A-compliant local tools"""
    
    def __init__(self, tool_def: A2ATool):
        self.tool_def = tool_def
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> A2AMessage:
        """Execute tool and return A2A message"""
        raise NotImplementedError


class CalendarTool(A2ALocalTool):
    """A2A-compliant Calendar display tool"""
    
    def __init__(self):
        tool_def = A2ATool(
            name="calendar_display",
            description="Displays a calendar interface for date selection and viewing",
            input_schema={
                "type": "object",
                "properties": {
                    "year": {"type": "integer", "description": "Calendar year"},
                    "month": {"type": "integer", "description": "Calendar month (1-12)"},
                    "events": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "date": {"type": "string"},
                                "title": {"type": "string"},
                                "description": {"type": "string"}
                            }
                        }
                    }
                },
                "required": ["year", "month"]
            },
            output_schema={
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "calendar"},
                    "data": {"type": "object"},
                    "rendered": {"type": "string"}
                }
            }
        )
        super().__init__(tool_def)
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> A2AMessage:
        """Execute calendar tool"""
        result = {
            "type": "calendar",
            "data": params,
            "rendered": f"Calendar for {params.get('year', datetime.now().year)}-{params.get('month', datetime.now().month)}"
        }
        
        return A2AMessage(
            jsonrpc="2.0",
            id=context.get("request_id"),
            result=result
        )


class FormTool(A2ALocalTool):
    """A2A-compliant Dynamic form generation tool"""
    
    def __init__(self):
        tool_def = A2ATool(
            name="dynamic_form",
            description="Creates dynamic forms for user input collection",
            input_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Form title"},
                    "fields": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "type": {"type": "string"},
                                "label": {"type": "string"},
                                "required": {"type": "boolean"},
                                "options": {"type": "array", "items": {"type": "string"}}
                            }
                        }
                    }
                },
                "required": ["title", "fields"]
            },
            output_schema={
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "form"},
                    "form_id": {"type": "string"},
                    "url": {"type": "string"},
                    "message": {"type": "string"}
                }
            }
        )
        super().__init__(tool_def)
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> A2AMessage:
        """Execute form tool"""
        try:
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
            
            return A2AMessage(
                jsonrpc="2.0",
                id=context.get("request_id"),
                result={
                    "type": "form",
                    "form_id": form_id,
                    "url": f"http://localhost:3000/api/forms/{form_id}",
                    "message": f"Please fill out the form: {params.get('title', 'Form')}"
                }
            )
        except Exception as e:
            return A2AMessage(
                jsonrpc="2.0",
                id=context.get("request_id"),
                error={
                    "code": -32603,
                    "message": "Internal error",
                    "data": {"details": str(e)}
                }
            )


class SMSTool(A2ALocalTool):
    """A2A-compliant SMS sending tool"""
    
    def __init__(self):
        tool_def = A2ATool(
            name="sms_send",
            description="Sends SMS messages to specified phone numbers",
            input_schema={
                "type": "object",
                "properties": {
                    "to_number": {"type": "string", "description": "Recipient phone number"},
                    "message": {"type": "string", "description": "SMS message content"}
                },
                "required": ["to_number", "message"]
            },
            output_schema={
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "sms"},
                    "status": {"type": "string"},
                    "message": {"type": "string"}
                }
            }
        )
        super().__init__(tool_def)
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> A2AMessage:
        """Execute SMS tool"""
        # In production, integrate with actual SMS service
        return A2AMessage(
            jsonrpc="2.0",
            id=context.get("request_id"),
            result={
                "type": "sms",
                "status": "sent",
                "message": f"SMS sent to {params.get('to_number', 'unknown')}"
            }
        )


class HelpTool(A2ALocalTool):
    """A2A-compliant Help request tool"""
    
    def __init__(self):
        tool_def = A2ATool(
            name="help_request",
            description="Records and manages help requests from users",
            input_schema={
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Help category"},
                    "urgency": {"type": "string", "enum": ["low", "medium", "high"]},
                    "description": {"type": "string", "description": "Detailed description"}
                },
                "required": ["description"]
            },
            output_schema={
                "type": "object",
                "properties": {
                    "type": {"type": "string", "const": "help"},
                    "status": {"type": "string"},
                    "message": {"type": "string"}
                }
            }
        )
        super().__init__(tool_def)
    
    async def execute(self, params: Dict[str, Any], context: Dict[str, Any]) -> A2AMessage:
        """Execute help tool"""
        try:
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
            
            return A2AMessage(
                jsonrpc="2.0",
                id=context.get("request_id"),
                result={
                    "type": "help",
                    "status": "recorded",
                    "message": "Your help request has been recorded and will be addressed soon."
                }
            )
        except Exception as e:
            return A2AMessage(
                jsonrpc="2.0",
                id=context.get("request_id"),
                error={
                    "code": -32603,
                    "message": "Internal error",
                    "data": {"details": str(e)}
                }
            )


class A2AMessageProcessor:
    """Handles A2A protocol message processing with Claude"""
    
    def __init__(self):
        # Initialize tools
        self.calendar_tool = CalendarTool()
        self.form_tool = FormTool()
        self.sms_tool = SMSTool()
        self.help_tool = HelpTool()
        
        self.tools = {
            "calendar_display": self.calendar_tool,
            "dynamic_form": self.form_tool,
            "sms_send": self.sms_tool,
            "help_request": self.help_tool
        }
        
        # Create agent card
        self.agent_card = A2AAgentCard(A2A_AGENT_ID, A2A_AGENT_NAME, A2A_AGENT_VERSION)
        for tool in self.tools.values():
            self.agent_card.add_tool(tool.tool_def)
    
    async def handle_a2a_request(self, message: A2AMessage) -> A2AMessage:
        """Handle incoming A2A request"""
        if message.method == "agent.discover":
            # Return agent card for discovery
            return A2AMessage(
                jsonrpc="2.0",
                id=message.id,
                result=self.agent_card.to_dict()
            )
        
        elif message.method == "tool.execute":
            # Execute tool
            tool_name = message.params.get("tool")
            tool_params = message.params.get("params", {})
            context = message.params.get("context", {})
            context["request_id"] = message.id
            
            if tool_name in self.tools:
                return await self.tools[tool_name].execute(tool_params, context)
            else:
                return A2AMessage(
                    jsonrpc="2.0",
                    id=message.id,
                    error={
                        "code": -32601,
                        "message": "Method not found",
                        "data": {"tool": tool_name}
                    }
                )
        
        elif message.method == "message.process":
            # Process message with Claude
            return await self.process_message_with_claude(message)
        
        else:
            return A2AMessage(
                jsonrpc="2.0",
                id=message.id,
                error={
                    "code": -32601,
                    "message": "Method not found"
                }
            )
    
    async def process_message_with_claude(self, a2a_message: A2AMessage) -> A2AMessage:
        """Process message using Claude and return A2A response"""
        try:
            params = a2a_message.params or {}
            content = params.get("content", "")
            conversation_history = params.get("history", [])
            
            # Filter relevant tools based on content
            relevant_tools = self.filter_tools(content)
            
            # Build tool definitions for Claude
            claude_tools = []
            for tool_name in relevant_tools:
                if tool_name in self.tools:
                    tool = self.tools[tool_name].tool_def
                    claude_tools.append({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema
                    })
            
            # Call Claude
            response = anthropic.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=4096,
                messages=conversation_history + [{"role": "user", "content": content}],
                tools=claude_tools if claude_tools else None,
                system="You are a helpful assistant analyzing messages and determining appropriate actions."
            )
            
            # Process Claude's response
            result = {
                "text": "",
                "tool_calls": []
            }
            
            for content_block in response.content:
                if content_block.type == "text":
                    result["text"] += content_block.text
                elif content_block.type == "tool_use":
                    # Execute tool and get result
                    tool_result = await self.tools[content_block.name].execute(
                        content_block.input,
                        {"conversation_id": params.get("conversation_id")}
                    )
                    
                    result["tool_calls"].append({
                        "tool": content_block.name,
                        "input": content_block.input,
                        "result": tool_result.result if tool_result.result else tool_result.error
                    })
            
            return A2AMessage(
                jsonrpc="2.0",
                id=a2a_message.id,
                result=result
            )
            
        except Exception as e:
            logger.error(f"Error processing message with Claude: {e}")
            return A2AMessage(
                jsonrpc="2.0",
                id=a2a_message.id,
                error={
                    "code": -32603,
                    "message": "Internal error",
                    "data": {"details": str(e)}
                }
            )
    
    def filter_tools(self, message_content: str) -> List[str]:
        """Filter tools based on message content"""
        tools = []
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


class A2AWorker:
    """A2A Protocol-compliant worker"""
    
    def __init__(self):
        self.processor = A2AMessageProcessor()
        self.running = True
    
    async def get_pending_message(self) -> Optional[Dict[str, Any]]:
        """Fetch a pending message from the database"""
        try:
            result = supabase.table("conversation_messages") \
                .select("*") \
                .eq("direction", "incoming") \
                .eq("status", "pending") \
                .order("created_at", desc=False) \
                .limit(1) \
                .execute()
            
            return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"Error fetching pending message: {e}")
            return None
    
    async def get_conversation_history(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Fetch conversation history"""
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
                
                # Handle tool results stored in metadata
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
    
    async def process_message(self, message: Dict[str, Any]):
        """Process a message using A2A protocol"""
        try:
            # Update status to processing
            supabase.table("conversation_messages") \
                .update({"status": "processing"}) \
                .eq("id", message["id"]) \
                .execute()
            
            # Get conversation history
            history = await self.get_conversation_history(message["conversation_id"])
            
            # Create A2A request
            a2a_request = A2AMessage(
                jsonrpc="2.0",
                id=str(uuid.uuid4()),
                method="message.process",
                params={
                    "content": message["content"],
                    "history": history,
                    "conversation_id": message["conversation_id"],
                    "from_number": message["from_number"]
                }
            )
            
            # Process with A2A handler
            a2a_response = await self.processor.handle_a2a_request(a2a_request)
            
            if a2a_response.error:
                raise Exception(f"A2A processing error: {a2a_response.error}")
            
            # Extract response
            result = a2a_response.result
            response_text = result.get("text", "")
            
            # Save response
            response_data = {
                "profile_id": message.get("profile_id"),
                "conversation_id": message["conversation_id"],
                "phone_number": message.get("phone_number", message.get("from_number")),
                "content": response_text,
                "from_number": message.get("to_number"),
                "to_number": message.get("from_number"),
                "direction": "outgoing",
                "status": "completed",
                "parent_message_id": message["id"],
                "metadata": {
                    "a2a_result": result,
                    "protocol": "A2A"
                },
                "thread_id": message.get("thread_id"),
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            supabase.table("conversation_messages").insert(response_data).execute()
            
            # Update original message status
            supabase.table("conversation_messages") \
                .update({"status": "completed"}) \
                .eq("id", message["id"]) \
                .execute()
            
            # Send SMS (placeholder)
            logger.info(f"Sending SMS to {message['from_number']}: {response_text}")
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            
            # Update status to failed
            supabase.table("conversation_messages") \
                .update({"status": "failed", "metadata": {"error": str(e)}}) \
                .eq("id", message["id"]) \
                .execute()
    
    async def process_loop(self):
        """Main processing loop"""
        logger.info(f"A2A Worker started (Agent: {A2A_AGENT_ID})")
        logger.info("Agent Card:")
        logger.info(json.dumps(self.processor.agent_card.to_dict(), indent=2))
        
        while self.running:
            try:
                # Get pending message
                message = await self.get_pending_message()
                
                if message:
                    logger.info(f"Processing message {message['id']} with A2A protocol")
                    await self.process_message(message)
                
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
    worker = A2AWorker()
    
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