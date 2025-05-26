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
            
            # Build enhanced prompt with system instructions
            enhanced_prompt = f"""
    Todays Date and Time: {datetime.now().strftime('%m/%d/%Y, %I:%M:%S %p')}

    The primary interface you're corresponding with is through text messages. 

    It's relatively important that you keep your responses short and to the point to that we can handle it like the text message that it is.

    Also - don't refer to the tools by name - that's confusing. Refer to the tools using concepts that are relatable to someone running an outfitting business.  

    You're corresponding with a client who is managing an outfitter, that outfitter has a website and accepts bookings (also called orders or orderlines). 
    They present those offerings as listings in a plugin page on their websites and we accept bookings in many ways. 
    We can create bookings through the plugin on their website, or we can create bookings through the phone, they can also create manual bookings through the website. 
    Sometimes they create completely custom bookings that don't relate to listings too.  

    I'm reviewing our conversation history. Please reference ALL previous messages in your response, including ones that might seem to be from a separate conversation. 

    Don't be confused by messages that seem unrelated - I expect you to have access to my entire message history, so treat all previous messages as relevant context.

    Please don't tell me that you're following my instructions - Please just follow them. For example - I don't need you to tell me that you're responding in a way that works for a text message, keeping the response short. Or anything like that.

    IMPORTANT: Before using tools, check if you've already used similar tools in previous messages. If relevant tool results already exist in our conversation history, use that information instead of making duplicate tool calls. This will save time and provide a better experience.

    For example, if you see I previously asked about generating a token and you already fetched that information, don't fetch it again - just reference the existing results and continue the conversation.

    Also - tool runs in this context occur immediately when you respond with a tool call. Please don't ask me for permission to run tools - if you need a tool run - please run it. 

    Here's my current message: {content}"""
            
            # Call Claude with enhanced prompt
            # Build the request parameters
            request_params = {
                "model": "claude-3-5-sonnet-20241022",
                "max_tokens": 1000,
                "temperature": 0.7,
                "messages": conversation_history + [{"role": "user", "content": enhanced_prompt}]
            }
            
            # Only add tools and tool_choice if we have tools
            if claude_tools:
                request_params["tools"] = claude_tools
                request_params["tool_choice"] = {"type": "auto", "disable_parallel_tool_use": False}
            
            response = anthropic.messages.create(**request_params)
            
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
        
        # Only include SMS tool if explicitly mentioned
        if any(word in content_lower for word in ["send", "text", "sms", "message someone", "notify"]):
            tools.append("sms_send")
        
        # If no tools matched, return empty list (Claude will just respond with text)
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
            # Check if conversation_id column exists by trying to query with it
            try:
                result = supabase.table("conversation_messages") \
                    .select("*") \
                    .eq("conversation_id", conversation_id) \
                    .order("created_at", desc=False) \
                    .execute()
            except Exception as e:
                # If conversation_id doesn't exist, fall back to parent chain method
                logger.info("conversation_id column not found, using parent chain method")
                return await self.get_conversation_history_by_parent_chain(conversation_id)
            
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
    
    async def get_conversation_history_by_parent_chain(self, message_id: str) -> List[Dict[str, Any]]:
        """Fetch conversation history by following parent chain (fallback for old schema)"""
        try:
            messages = []
            current_id = message_id
            
            # Follow parent chain to build history
            while current_id:
                result = supabase.table("conversation_messages") \
                    .select("*") \
                    .eq("id", current_id) \
                    .single() \
                    .execute()
                
                if result.data:
                    msg = result.data
                    messages.insert(0, msg)  # Insert at beginning to maintain order
                    current_id = msg.get("parent_message_id")
                else:
                    break
            
            # Convert to Claude format
            claude_messages = []
            for msg in messages[:-1]:  # Exclude current message
                role = "user" if msg["direction"] == "incoming" else "assistant"
                content = msg["content"]
                
                # Handle tool results
                if msg.get("tool_result_for"):
                    content = [{
                        "type": "tool_result",
                        "tool_use_id": msg["tool_result_for"],
                        "content": json.dumps(msg.get("tool_results", {}))
                    }]
                
                claude_messages.append({
                    "role": role,
                    "content": content
                })
            
            return claude_messages
        except Exception as e:
            logger.error(f"Error fetching conversation history by parent chain: {e}")
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
            # Use conversation_id if available, otherwise use message id
            conversation_id = message.get("conversation_id", message["id"])
            history = await self.get_conversation_history(conversation_id)
            
            # Create A2A request
            # Handle both old schema (phone_number) and new schema (from_number/to_number)
            from_number = message.get("from_number") or message.get("phone_number")
            to_number = message.get("to_number") or message.get("phone_number")
            
            a2a_request = A2AMessage(
                jsonrpc="2.0",
                id=str(uuid.uuid4()),
                method="message.process",
                params={
                    "content": message["content"],
                    "history": history,
                    "conversation_id": message.get("conversation_id", message["id"]),
                    "from_number": from_number,
                    "to_number": to_number
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
            # Handle both old and new schema
            sender_number = message.get("from_number") or message.get("phone_number")
            recipient_number = message.get("to_number") or message.get("phone_number")
            
            response_data = {
                "profile_id": message.get("profile_id"),
                "phone_number": sender_number,  # Always include for backward compatibility
                "content": response_text,
                "direction": "outgoing",
                "status": "completed",
                "parent_message_id": message["id"],
                "metadata": {
                    "a2a_result": result,
                    "protocol": "A2A"
                },
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            # Add new columns if they exist in the database
            if "conversation_id" in message:
                response_data["conversation_id"] = message["conversation_id"]
            if "from_number" in message:
                response_data["from_number"] = recipient_number  # Swap for response
                response_data["to_number"] = sender_number
            if "thread_id" in message:
                response_data["thread_id"] = message.get("thread_id")
            
            supabase.table("conversation_messages").insert(response_data).execute()
            
            # Update original message status
            supabase.table("conversation_messages") \
                .update({"status": "completed"}) \
                .eq("id", message["id"]) \
                .execute()
            
            # Send SMS via Supabase function
            # Get the recipient number (incoming message's sender)
            recipient = message.get("from_number") or message.get("phone_number")
            
            if response_text and recipient:
                try:
                    # Use Supabase function to send SMS
                    sms_result = supabase.functions.invoke(
                        "send-sms",
                        invoke_options={
                            "body": {
                                "to": recipient,
                                "message": response_text
                            }
                        }
                    )
                    logger.info(f"SMS sent to {recipient}: {response_text[:100]}...")
                except Exception as sms_error:
                    logger.error(f"Failed to send SMS: {sms_error}")
                    # Don't fail the whole process if SMS fails
            else:
                logger.warning(f"No SMS sent - recipient: {recipient}, has_response: {bool(response_text)}")
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            
            # Update status to failed
            error_update = {"status": "failed"}
            
            # Only add metadata if column exists
            if "metadata" in message:
                error_update["metadata"] = {"error": str(e)}
            else:
                # Use error_message column for old schema
                error_update["error_message"] = str(e)
            
            supabase.table("conversation_messages") \
                .update(error_update) \
                .eq("id", message["id"]) \
                .execute()
            
            # Send error SMS to user
            recipient = message.get("from_number") or message.get("phone_number")
            if recipient:
                try:
                    error_message = "I apologize, but I encountered an error processing your message. Please try again or contact support if the issue persists."
                    
                    # Include more details for specific errors
                    if "rate_limit" in str(e).lower():
                        error_message = "I'm currently experiencing high demand. Please try again in a few moments."
                    elif "connection" in str(e).lower() or "network" in str(e).lower():
                        error_message = "I'm having trouble connecting to services. Please try again shortly."
                    
                    sms_result = supabase.functions.invoke(
                        "send-sms",
                        invoke_options={
                            "body": {
                                "to": recipient,
                                "message": error_message
                            }
                        }
                    )
                    logger.info(f"Error SMS sent to {recipient}")
                except Exception as sms_error:
                    logger.error(f"Failed to send error SMS: {sms_error}")
    
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