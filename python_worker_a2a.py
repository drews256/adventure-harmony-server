#!/usr/bin/env python3
"""
A2A Protocol-compliant Python Worker with MCP support
Connects to MCP server for OCTO/GoGuide tools
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

# Add morning update support
agents_path = os.path.join(os.path.dirname(__file__), 'src', 'agents')
sys.path.append(agents_path)
try:
    from morning_update import MorningUpdateManager
    MORNING_UPDATE_AVAILABLE = True
    logging.info(f"Morning update module loaded successfully from {agents_path}")
except ImportError as e:
    MORNING_UPDATE_AVAILABLE = False
    logging.warning(f"Morning update module not available: {e}")

# Try to import MCP
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from mcp.client.streamable_http import streamablehttp_client
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    logging.warning("MCP module not available - install with: pip install mcp")

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

# MCP Configuration
MCP_ENDPOINT = os.getenv('MCP_ENDPOINT', 'https://goguide-mcp-server-b0a0c27ffa32.herokuapp.com/mcp')

# A2A Configuration
A2A_AGENT_ID = os.getenv('A2A_AGENT_ID', 'message-analysis-agent')
A2A_AGENT_NAME = os.getenv('A2A_AGENT_NAME', 'Message Analysis Agent')
A2A_AGENT_VERSION = '1.0.0'

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
anthropic = Anthropic(api_key=ANTHROPIC_API_KEY)


class MCPClient:
    """MCP Client using direct HTTP requests (bypass streamable HTTP issues)"""
    
    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.session = None
        self.tools = []
        self.connected = False
        self._read_stream = None
        self._write_stream = None
        self._connection_context = None
        self._request_id_counter = 0
    
    async def connect(self):
        """Connect to MCP server using direct HTTP requests"""
        try:
            logger.info(f"🔗 Attempting to connect to MCP server at {self.endpoint}")
            
            # Test connection with initialize request
            init_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_request_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "roots": {"listChanged": True},
                        "sampling": {}
                    },
                    "clientInfo": {
                        "name": "python-worker-a2a",
                        "version": "1.0.0"
                    }
                }
            }
            
            logger.info("📤 Sending initialize request via HTTP")
            init_result = await self._send_http_request(init_request)
            
            if init_result and init_result.get('jsonrpc') == '2.0' and 'result' in init_result:
                result = init_result['result']
                self.connected = True
                logger.info("✅ Successfully connected to MCP server")
                
                logger.info(f"🔧 Server info: {result.get('serverInfo', 'N/A')}")
                logger.info(f"📋 Protocol version: {result.get('protocolVersion', 'N/A')}")
                logger.info(f"🔧 Capabilities: {result.get('capabilities', 'N/A')}")
                
                # Get available tools
                await self.refresh_tools()
            elif init_result and 'error' in init_result:
                logger.error(f"❌ Initialize failed with error: {init_result['error']}")
                self.connected = False
            else:
                logger.error(f"❌ Initialize returned unexpected response: {init_result}")
                self.connected = False
                
        except Exception as e:
            logger.error(f"💥 Error connecting to MCP: {e}")
            logger.error(f"🔍 Exception type: {type(e).__name__}")
            import traceback
            logger.error(f"🔍 Full traceback: {traceback.format_exc()}")
            self.connected = False
    
    def _get_next_request_id(self):
        """Get next request ID"""
        self._request_id_counter += 1
        return f"req_{self._request_id_counter}_{int(time.time())}"
    
    async def _send_http_request(self, request_data):
        """Send HTTP request to MCP server and parse SSE response"""
        async with httpx.AsyncClient() as client:
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
            
            logger.info(f"📤 HTTP Request: {request_data}")
            
            response = await client.post(
                self.endpoint,
                json=request_data,
                headers=headers,
                timeout=30.0
            )
            
            logger.info(f"📥 HTTP Response Status: {response.status_code}")
            logger.info(f"📥 HTTP Response Headers: {dict(response.headers)}")
            
            if response.status_code != 200:
                raise Exception(f"HTTP error: {response.status_code} - {response.text}")
            
            # Parse SSE response
            response_text = response.text
            logger.info(f"📥 HTTP Response Body: {response_text}")
            
            # Parse SSE format: "event: message\ndata: {...}\n"
            if response_text.startswith('event: message\ndata: '):
                data_line = response_text.split('\ndata: ', 1)[1].strip()
                try:
                    return json.loads(data_line)
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse JSON data: {data_line}")
                    raise e
            else:
                # Try parsing as direct JSON
                try:
                    return json.loads(response_text)
                except json.JSONDecodeError:
                    logger.error(f"Unexpected response format: {response_text}")
                    raise Exception(f"Unexpected response format: {response_text}")
    
    async def refresh_tools(self):
        """Get available tools from MCP server"""
        try:
            if not self.connected:
                logger.error("❌ Not connected - cannot fetch tools")
                return
                
            logger.info("🔧 Fetching tools from MCP server")
            
            # Send tools/list request
            tools_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_request_id(),
                "method": "tools/list",
                "params": {}
            }
            
            tools_result = await self._send_http_request(tools_request)
            
            if tools_result and tools_result.get('jsonrpc') == '2.0' and 'result' in tools_result:
                result = tools_result['result']
                tools_list = result.get('tools', [])
                
                self.tools = []
                for tool in tools_list:
                    tool_dict = {
                        "name": tool.get("name", ""),
                        "description": tool.get("description", ""),
                        "inputSchema": tool.get("inputSchema", {"type": "object"})
                    }
                    self.tools.append(tool_dict)
                    
                logger.info(f"✅ Retrieved {len(self.tools)} tools from MCP server")
                
                # Log each tool in detail
                for i, tool in enumerate(self.tools):
                    logger.info(f"  🔧 Tool {i+1}: {tool['name']} - {tool['description']}")
                    logger.info(f"     📋 Schema: {tool['inputSchema']}")
                
                if len(self.tools) == 0:
                    logger.warning("⚠️  No tools returned from MCP server")
            elif tools_result and 'error' in tools_result:
                logger.error(f"❌ Tools list failed with error: {tools_result['error']}")
            else:
                logger.error(f"❌ Tools list returned unexpected response: {tools_result}")
                
        except Exception as e:
            logger.error(f"💥 Error getting tools from MCP: {e}")
            logger.error(f"🔍 Exception type: {type(e).__name__}")
            import traceback
            logger.error(f"🔍 Full traceback: {traceback.format_exc()}")
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool through MCP"""
        try:
            if not self.connected:
                logger.error("❌ Not connected - cannot call tool")
                return {"error": "No active MCP connection"}
                
            logger.info(f"🔧 Calling tool: {tool_name} with args: {arguments}")
            
            # Send tools/call request
            tool_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_request_id(),
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                }
            }
            
            tool_result = await self._send_http_request(tool_request)
            
            logger.info(f"📥 Tool result: {tool_result}")
            
            if tool_result and tool_result.get('jsonrpc') == '2.0' and 'result' in tool_result:
                result = tool_result['result']
                
                # Handle different result formats
                if isinstance(result, dict) and 'content' in result:
                    content = result['content']
                    if isinstance(content, list) and len(content) > 0:
                        # Return the first content item
                        first_content = content[0]
                        if isinstance(first_content, dict) and 'text' in first_content:
                            return {"result": first_content['text']}
                        else:
                            return {"result": str(first_content)}
                    else:
                        return {"result": str(content)}
                else:
                    return {"result": result}
            elif tool_result and 'error' in tool_result:
                logger.error(f"❌ Tool call failed with error: {tool_result['error']}")
                return {"error": str(tool_result['error'])}
            else:
                logger.error(f"❌ Tool call returned unexpected response: {tool_result}")
                return {"error": "Unexpected response format"}
                
        except Exception as e:
            logger.error(f"💥 Error calling MCP tool {tool_name}: {e}")
            logger.error(f"🔍 Exception type: {type(e).__name__}")
            import traceback
            logger.error(f"🔍 Full traceback: {traceback.format_exc()}")
            return {"error": str(e)}
    
    async def close(self):
        """Close MCP connection"""
        # No persistent connections to close for HTTP client
        self.connected = False
        self.session = None
        self._read_stream = None
        self._write_stream = None
        self._connection_context = None
        logger.info("🔌 MCP connection closed")


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
        self.description = "AI agent for message analysis and task execution with MCP support"
    
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
                "protocol_version": "1.0",
                "mcp_enabled": MCP_AVAILABLE
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
        # Store calendar display in database
        calendar_data = {
            "message_id": context.get("message_id"),
            "year": params.get("year", datetime.now().year),
            "month": params.get("month", datetime.now().month),
            "events": json.dumps(params.get("events", [])),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        try:
            result = supabase.table("calendar_displays").insert(calendar_data).execute()
            calendar_id = result.data[0]["id"]
            
            return A2AMessage(
                jsonrpc="2.0",
                id=context.get("request_id"),
                result={
                    "type": "calendar",
                    "calendar_id": calendar_id,
                    "data": params,
                    "rendered": f"Calendar for {params.get('year', datetime.now().year)}-{params.get('month', datetime.now().month)}"
                }
            )
        except Exception as e:
            logger.error(f"Error storing calendar: {e}")
            return A2AMessage(
                jsonrpc="2.0",
                id=context.get("request_id"),
                result={
                    "type": "calendar",
                    "data": params,
                    "rendered": f"Calendar for {params.get('year', datetime.now().year)}-{params.get('month', datetime.now().month)}"
                }
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
            # Store form in database - using message_id from context
            form_data = {
                "conversation_id": context.get("message_id", str(uuid.uuid4())),
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
                "conversation_id": context.get("message_id", str(uuid.uuid4())),
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
    """Handles A2A protocol message processing with Claude and MCP"""
    
    def __init__(self):
        # Initialize local tools
        self.calendar_tool = CalendarTool()
        self.form_tool = FormTool()
        self.sms_tool = SMSTool()
        self.help_tool = HelpTool()
        
        self.local_tools = {
            "calendar_display": self.calendar_tool,
            "dynamic_form": self.form_tool,
            "sms_send": self.sms_tool,
            "help_request": self.help_tool
        }
        
        # MCP client for OCTO tools
        self.mcp_client = MCPClient(MCP_ENDPOINT) if MCP_AVAILABLE else None
        self.mcp_tools = {}
        
        # Create agent card
        self.agent_card = A2AAgentCard(A2A_AGENT_ID, A2A_AGENT_NAME, A2A_AGENT_VERSION)
        for tool in self.local_tools.values():
            self.agent_card.add_tool(tool.tool_def)
    
    async def initialize(self):
        """Initialize MCP connection and get tools"""
        logger.info("🚀 Initializing A2A Message Processor")
        logger.info(f"🌐 MCP_AVAILABLE: {MCP_AVAILABLE}")
        logger.info(f"🔗 MCP_ENDPOINT: {MCP_ENDPOINT}")
        
        if MCP_AVAILABLE and self.mcp_client:
            logger.info("🔧 Initializing MCP client connection...")
            try:
                await self.mcp_client.connect()
            except Exception as e:
                logger.error(f"⚠️  MCP connection failed: {e}")
                logger.error("⚠️  Continuing without MCP tools - local tools still available")
                self.mcp_client.connected = False
            
            if self.mcp_client.connected:
                logger.info(f"✅ MCP connected! Found {len(self.mcp_client.tools)} tools")
                
                # Add ALL MCP tools to our available tools (no filtering)
                for i, mcp_tool in enumerate(self.mcp_client.tools):
                    tool_name = mcp_tool.get("name", f"tool_{i}")
                    tool_desc = mcp_tool.get("description", "No description")
                    
                    # Create A2A tool definition for MCP tool
                    a2a_tool = A2ATool(
                        name=tool_name,
                        description=tool_desc,
                        input_schema=mcp_tool.get("inputSchema", {"type": "object"})
                    )
                    self.mcp_tools[tool_name] = a2a_tool
                    self.agent_card.add_tool(a2a_tool)
                    logger.info(f"  ✅ Added MCP tool {i+1}: {tool_name} - {tool_desc}")
                
                logger.info(f"🎯 Total MCP tools registered: {len(self.mcp_tools)}")
            else:
                logger.warning("⚠️  MCP client failed to connect - no MCP tools available")
        else:
            if not MCP_AVAILABLE:
                logger.warning("⚠️  MCP not available - MCP tools disabled")
            else:
                logger.warning("⚠️  MCP client not initialized - MCP tools disabled")
        
        # Log final tool summary
        total_tools = len(self.local_tools) + len(self.mcp_tools)
        logger.info(f"🔧 Tool Summary: {len(self.local_tools)} local + {len(self.mcp_tools)} MCP = {total_tools} total tools")
    
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
            
            if tool_name in self.local_tools:
                return await self.local_tools[tool_name].execute(tool_params, context)
            elif tool_name in self.mcp_tools and self.mcp_client:
                # Execute MCP tool
                result = await self.mcp_client.call_tool(tool_name, tool_params)
                return A2AMessage(
                    jsonrpc="2.0",
                    id=message.id,
                    result=result
                )
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
            
            # Get all tools (local + MCP)
            all_tools = list(self.local_tools.keys()) + list(self.mcp_tools.keys())
            
            # Build tool definitions for Claude
            claude_tools = []
            for tool_name in all_tools:
                if tool_name in self.local_tools:
                    tool = self.local_tools[tool_name].tool_def
                elif tool_name in self.mcp_tools:
                    tool = self.mcp_tools[tool_name]
                else:
                    continue
                    
                claude_tools.append({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema
                })
            
            # Build system content with cache control for the system parameter
            system_content = [
                {
                    "type": "text",
                    "text": """The primary interface you're corresponding with is through text messages. 

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

Also - tool runs in this context occur immediately when you respond with a tool call. Please don't ask me for permission to run tools - if you need a tool run - please run it.""",
                    "cache_control": {"type": "ephemeral"}
                }
            ]
            
            # Build user prompt with current context
            enhanced_prompt = f"""Todays Date and Time: {datetime.now().strftime('%m/%d/%Y, %I:%M:%S %p')}

Here's my current message: {content}"""
            
            # Initialize tool iteration counter
            tool_iterations = 0
            MAX_TOOL_ITERATIONS = 5
            
            # Build initial messages with cache control
            messages = []
            
            # Add conversation history if we have history
            if conversation_history:
                # Add conversation history as-is, it's already been processed
                messages.extend(conversation_history)
            
            # Add the current user message
            messages.append({"role": "user", "content": enhanced_prompt})
            
            # Result container
            result = {
                "text": "",
                "tool_calls": []
            }
            
            # Main processing loop with iteration limit
            while tool_iterations < MAX_TOOL_ITERATIONS:
                # Build the request parameters
                request_params = {
                    "model": "claude-3-5-sonnet-20241022",  # This model supports prompt caching
                    "max_tokens": 1000,
                    "temperature": 0.7,
                    "system": system_content,  # System parameter with cache control
                    "messages": messages
                }
                
                # Only add tools and tool_choice if we have tools
                if claude_tools:
                    request_params["tools"] = claude_tools
                    request_params["tool_choice"] = {"type": "auto", "disable_parallel_tool_use": False}
                
                # Call Claude with prompt caching
                response = anthropic.messages.create(**request_params)
                
                # Log cache usage if available
                if hasattr(response, 'usage') and hasattr(response.usage, 'cache_creation_input_tokens'):
                    cache_creation = getattr(response.usage, 'cache_creation_input_tokens', 0)
                    cache_read = getattr(response.usage, 'cache_read_input_tokens', 0)
                    if cache_creation > 0 or cache_read > 0:
                        logger.info(f"💾 Cache usage - Created: {cache_creation} tokens, Read: {cache_read} tokens")
                
                # Check if Claude made any tool calls
                has_tool_calls = any(content_block.type == "tool_use" for content_block in response.content)
                
                if not has_tool_calls:
                    # No tool calls, extract text and break
                    for content_block in response.content:
                        if content_block.type == "text":
                            result["text"] += content_block.text
                    break
                
                # Process tool calls
                tool_iterations += 1
                logger.info(f"🔄 Tool iteration {tool_iterations}/{MAX_TOOL_ITERATIONS}")
                
                # Execute tools and collect results
                tool_results = []
                
                for content_block in response.content:
                    if content_block.type == "text":
                        # Collect any text before tool calls
                        pass  # We'll get the final text from the last response
                    elif content_block.type == "tool_use":
                        # Execute tool and get result
                        tool_name = content_block.name
                        tool_use_id = content_block.id
                        
                        logger.info(f"🔧 Executing tool: {tool_name}")
                        
                        if tool_name in self.local_tools:
                            tool_result = await self.local_tools[tool_name].execute(
                                content_block.input,
                                {"message_id": params.get("message_id")}
                            )
                            result["tool_calls"].append({
                                "tool": tool_name,
                                "input": content_block.input,
                                "result": tool_result.result if tool_result.result else tool_result.error
                            })
                            # Prepare tool result for Claude
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": json.dumps(tool_result.result if tool_result.result else tool_result.error)
                            })
                        elif tool_name in self.mcp_tools and self.mcp_client:
                            # Execute MCP tool
                            mcp_result = await self.mcp_client.call_tool(tool_name, content_block.input)
                            result["tool_calls"].append({
                                "tool": tool_name,
                                "input": content_block.input,
                                "result": mcp_result
                            })
                            # Prepare tool result for Claude
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": json.dumps(mcp_result)
                            })
                
                # Add assistant response and tool results to messages
                messages.append({"role": "assistant", "content": response.content})
                
                # Add tool results with cache control on the first result
                if tool_results:
                    # Add cache control to the first tool result
                    cached_tool_results = []
                    for i, tool_result in enumerate(tool_results):
                        cached_result = tool_result.copy()
                        if i == 0:
                            cached_result["cache_control"] = {"type": "ephemeral"}
                        cached_tool_results.append(cached_result)
                    messages.append({"role": "user", "content": cached_tool_results})
                else:
                    messages.append({"role": "user", "content": tool_results})
                
                # Check if we've hit the iteration limit
                if tool_iterations >= MAX_TOOL_ITERATIONS:
                    logger.warning(f"⚠️ Reached maximum tool iterations ({MAX_TOOL_ITERATIONS}). Stopping tool execution.")
                    # Add a final message to get Claude's response without tools
                    final_params = {
                        "model": "claude-3-5-sonnet-20241022",
                        "max_tokens": 1000,
                        "temperature": 0.7,
                        "system": system_content,  # Include system parameter
                        "messages": messages + [{"role": "user", "content": "Please provide a final response based on the tool results you've gathered. No more tools are available."}]
                    }
                    final_response = anthropic.messages.create(**final_params)
                    
                    # Extract final text
                    for content_block in final_response.content:
                        if content_block.type == "text":
                            result["text"] += content_block.text
                    break
            
            # If we exited the loop normally (no more tool calls), we've already extracted the text
            # in the main loop when has_tool_calls was False, so we don't need to do it again
            
            logger.info(f"✅ Completed processing with {tool_iterations} tool iteration(s)")
            logger.info(f"📊 Final result structure: text={len(result.get('text', ''))} chars, tool_calls={len(result.get('tool_calls', []))} calls")
            
            return A2AMessage(
                jsonrpc="2.0",
                id=a2a_message.id,
                result=result
            )
            
        except Exception as e:
            logger.error(f"Error processing message with Claude: {e}")
            logger.error(f"Exception type: {type(e).__name__}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return A2AMessage(
                jsonrpc="2.0",
                id=a2a_message.id,
                error={
                    "code": -32603,
                    "message": "Internal error",
                    "data": {"details": str(e)}
                }
            )


class A2AWorker:
    """A2A Protocol-compliant worker with MCP support"""
    
    def __init__(self):
        self.processor = A2AMessageProcessor()
        self.running = True
        self.morning_update_manager = None
        self.last_morning_update_check = None
    
    async def initialize(self):
        """Initialize the worker and MCP connection"""
        await self.processor.initialize()
        
        # Initialize morning update manager if available
        if MORNING_UPDATE_AVAILABLE and self.processor.mcp_client:
            self.morning_update_manager = MorningUpdateManager(
                supabase, 
                self.processor.mcp_client
            )
            logger.info("Morning update manager initialized")
    
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
    
    async def get_conversation_history_by_phone(self, phone_number: str, current_message_id: str) -> List[Dict[str, Any]]:
        """Fetch conversation history with a specific phone number, limited to last 50 messages
        
        This simplified approach treats all messages to/from a phone number as one continuous
        conversation, which makes more sense for SMS where users expect their entire message
        history to be available as context.
        """
        try:
            # Get last 50 messages to/from this phone number (excluding current message)
            # We use phone_number field which should always be present
            result = supabase.table("conversation_messages") \
                .select("*") \
                .eq("phone_number", phone_number) \
                .neq("id", current_message_id) \
                .order("created_at", desc=True) \
                .limit(50) \
                .execute()
            
            if not result.data:
                logger.info(f"No previous messages found for phone number: {phone_number}")
                return []
            
            # Reverse to get chronological order (oldest first)
            messages = list(reversed(result.data))
            logger.info(f"Found {len(messages)} messages for phone number: {phone_number} (limited to last 50)")
            
            # Build conversation history with proper tool handling
            claude_messages = self.build_conversation_history_with_tools(messages)
            
            # Apply token-based filtering
            return self.filter_messages_by_tokens(claude_messages)
            
        except Exception as e:
            logger.error(f"Error fetching conversation history by phone: {e}")
            return []
    
    def build_conversation_history_with_tools(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Build conversation history with proper Claude format for tools"""
        claude_messages = []
        
        # Process all messages in order
        i = 0
        while i < len(messages):
            msg = messages[i]
            
            # Skip empty content messages
            if not msg.get("content") or (isinstance(msg["content"], str) and not msg["content"].strip()):
                i += 1
                continue
            
            role = "user" if msg["direction"] == "incoming" else "assistant"
            
            # Check if this message has tool calls
            if msg.get("tool_calls") and isinstance(msg["tool_calls"], list) and len(msg["tool_calls"]) > 0:
                # This is an assistant message with tool calls
                tool_use_content = []
                
                # Add text content if present
                text_content = msg["content"] if msg["content"] and msg["content"].strip() else "Using tools"
                tool_use_content.append({"type": "text", "text": text_content})
                
                # Add tool use blocks
                for tool_call in msg["tool_calls"]:
                    if tool_call.get("id") and tool_call.get("name"):
                        tool_use_content.append({
                            "type": "tool_use",
                            "id": tool_call["id"],
                            "name": tool_call["name"],
                            "input": tool_call.get("input", tool_call.get("arguments", {}))
                        })
                
                # Add assistant message with tool uses
                claude_messages.append({
                    "role": "assistant",
                    "content": tool_use_content
                })
                
                # Look for tool results in subsequent messages
                tool_result_blocks = []
                j = i + 1
                while j < len(messages):
                    result_msg = messages[j]
                    if result_msg.get("tool_result_for"):
                        # This is a tool result message
                        tool_result_blocks.append({
                            "type": "tool_result",
                            "tool_use_id": result_msg["tool_result_for"],
                            "content": result_msg.get("content", json.dumps({"status": "success"}))
                        })
                        j += 1
                    else:
                        break
                
                # Always add tool results - if none found, create synthetic ones
                if not tool_result_blocks:
                    # Create synthetic tool results for any tool uses that don't have results
                    for tool_call in msg["tool_calls"]:
                        if tool_call.get("id") and tool_call.get("name"):
                            tool_result_blocks.append({
                                "type": "tool_result",
                                "tool_use_id": tool_call["id"],
                                "content": json.dumps({"status": "success", "message": "Tool executed successfully"})
                            })
                
                # Add user message with tool results
                claude_messages.append({
                    "role": "user",
                    "content": tool_result_blocks
                })
                
                i = j if j > i + 1 else i + 1  # Skip past processed messages
                    
            elif msg.get("tool_result_for"):
                # Skip tool result messages that were already processed
                i += 1
                continue
                
            else:
                # Regular text message
                claude_messages.append({
                    "role": role,
                    "content": msg["content"]
                })
                i += 1
        
        # Validate that every tool_use has a corresponding tool_result
        validated_messages = self.validate_tool_use_results(claude_messages)
        return validated_messages
    
    def validate_tool_use_results(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Ensure every tool_use block has a corresponding tool_result in the next message"""
        validated = []
        i = 0
        
        while i < len(messages):
            msg = messages[i]
            validated.append(msg)
            
            # Check if this is an assistant message with tool_use blocks
            if (msg.get("role") == "assistant" and 
                isinstance(msg.get("content"), list) and 
                any(block.get("type") == "tool_use" for block in msg["content"])):
                
                # Get all tool_use ids from this message
                tool_use_ids = [
                    block["id"] for block in msg["content"] 
                    if block.get("type") == "tool_use" and block.get("id")
                ]
                
                # Check if next message has matching tool_results
                has_next = i + 1 < len(messages)
                has_tool_results = False
                
                if has_next:
                    next_msg = messages[i + 1]
                    if (next_msg.get("role") == "user" and 
                        isinstance(next_msg.get("content"), list)):
                        
                        result_ids = [
                            block.get("tool_use_id") for block in next_msg["content"]
                            if block.get("type") == "tool_result"
                        ]
                        
                        # Check if all tool_use ids have results
                        has_tool_results = all(tid in result_ids for tid in tool_use_ids)
                
                # If no matching tool results, create them
                if not has_tool_results:
                    logger.warning(f"Creating synthetic tool results for {len(tool_use_ids)} tool uses")
                    synthetic_results = []
                    for tool_use_id in tool_use_ids:
                        synthetic_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": json.dumps({"status": "success", "message": "Tool completed"})
                        })
                    
                    # Insert synthetic results message
                    validated.append({
                        "role": "user",
                        "content": synthetic_results
                    })
                    
                    # Skip the next message if it was the one we checked
                    if has_next and next_msg.get("role") == "user":
                        i += 1
            
            i += 1
        
        return validated
    
    def estimate_token_count(self, messages: List[Dict[str, Any]]) -> int:
        """Estimate token count for messages (rough approximation)"""
        total_chars = 0
        
        for msg in messages:
            # Count role
            total_chars += len(msg.get("role", ""))
            
            # Count content
            content = msg.get("content", "")
            if isinstance(content, str):
                total_chars += len(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        # Count all string values in the block
                        for value in block.values():
                            if isinstance(value, str):
                                total_chars += len(value)
        
        # Rough approximation: ~4 characters per token
        return total_chars // 4
    
    def filter_messages_by_tokens(self, messages: List[Dict[str, Any]], max_tokens: int = 40000) -> List[Dict[str, Any]]:
        """Filter messages to stay under token limit, reducing from the beginning"""
        if not messages:
            return messages
        
        # Start with all messages
        filtered_messages = messages[:]
        
        # Keep reducing from the beginning until we're under the limit
        while len(filtered_messages) > 0:
            token_count = self.estimate_token_count(filtered_messages)
            
            if token_count <= max_tokens:
                break
            
            # Remove the oldest message (first in the list)
            filtered_messages = filtered_messages[1:]
            
            # Log the reduction
            if len(filtered_messages) % 10 == 0:  # Log every 10 reductions
                logger.info(f"Reduced conversation history to {len(filtered_messages)} messages (~{token_count} tokens)")
        
        final_token_count = self.estimate_token_count(filtered_messages)
        if len(filtered_messages) < len(messages):
            logger.info(f"Filtered conversation history from {len(messages)} to {len(filtered_messages)} messages (~{final_token_count} tokens)")
        
        return filtered_messages
    
    async def process_message(self, message: Dict[str, Any]):
        """Process a message using A2A protocol"""
        try:
            # Update status to processing
            supabase.table("conversation_messages") \
                .update({"status": "processing"}) \
                .eq("id", message["id"]) \
                .execute()
            
            # Get conversation history based on phone number
            # This gives us all the back-and-forth messages with this phone number
            phone_number = message.get("phone_number", "")
            
            logger.info(f"Fetching conversation history for phone number: {phone_number}")
            history = await self.get_conversation_history_by_phone(phone_number, message["id"])
            
            logger.info(f"Retrieved {len(history)} messages in conversation history")
            
            # Log conversation history structure for debugging
            if history:
                logger.info("Conversation history structure:")
                for i, msg in enumerate(history):
                    role = msg.get("role", "unknown")
                    content_type = "text" if isinstance(msg.get("content"), str) else "array"
                    
                    if content_type == "array" and isinstance(msg["content"], list):
                        block_types = [b.get("type", "unknown") for b in msg["content"]]
                        logger.info(f"  [{i}] Role: {role}, Content: {content_type}, Blocks: {block_types}")
                    else:
                        content_preview = str(msg.get("content", ""))[:50]
                        logger.info(f"  [{i}] Role: {role}, Content: {content_preview}...")
            
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
                    "message_id": message["id"],
                    "phone_number": phone_number,
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
            
            # Validate result structure
            if not isinstance(result, dict):
                logger.error(f"Unexpected result type: {type(result)}, value: {result}")
                raise Exception(f"Invalid result type: expected dict, got {type(result)}")
            
            response_text = result.get("text", "")
            
            # Save response - keep it simple
            phone_number = message.get("phone_number", "")
            
            response_data = {
                "profile_id": message.get("profile_id"),
                "phone_number": phone_number,  # Same phone number for conversation continuity
                "content": response_text,
                "direction": "outgoing",
                "status": "completed",
                "parent_message_id": message["id"],
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            
            # Only add optional fields if they exist in the original message
            if "metadata" in message:
                # Ensure result is JSON serializable
                metadata_result = {
                    "text": result.get("text", ""),
                    "tool_calls": result.get("tool_calls", [])
                }
                response_data["metadata"] = {
                    "a2a_result": metadata_result,
                    "protocol": "A2A"
                }
            
            # Only include these fields if they exist in the database schema
            if "conversation_id" in message and message.get("conversation_id"):
                response_data["conversation_id"] = message["conversation_id"]
            
            if "from_number" in message:
                # For outgoing messages: from = system, to = user's phone
                response_data["from_number"] = message.get("to_number", "")  # System's number
                response_data["to_number"] = message.get("from_number", phone_number)  # User's number
                
            if "thread_id" in message and message.get("thread_id"):
                response_data["thread_id"] = message["thread_id"]
            
            supabase.table("conversation_messages").insert(response_data).execute()
            
            # Update original message status
            supabase.table("conversation_messages") \
                .update({"status": "completed"}) \
                .eq("id", message["id"]) \
                .execute()
            
            # Log successful processing
            logger.info(f"Successfully processed message {message['id']}")
            logger.info(f"Response length: {len(response_text)} characters")
            logger.info(f"Tool calls made: {len(result.get('tool_calls', []))}")
            
            # Send SMS via Supabase function
            # Get the recipient number (incoming message's sender)
            recipient = message.get("from_number") or message.get("phone_number")
            
            if response_text and recipient:
                try:
                    # Use Supabase function to send SMS
                    logger.info(f"Attempting to send SMS to {recipient}")
                    sms_result = supabase.functions.invoke(
                        "send-sms",
                        invoke_options={
                            "body": {
                                "to": recipient,
                                "message": response_text
                            }
                        }
                    )
                    logger.info(f"SMS sent successfully to {recipient}: {response_text[:100]}...")
                    logger.info(f"SMS result: {sms_result}")
                except Exception as sms_error:
                    logger.error(f"Failed to send SMS: {sms_error}")
                    logger.error(f"SMS error type: {type(sms_error).__name__}")
                    logger.error(f"SMS error details: {str(sms_error)}")
                    # Don't fail the whole process if SMS fails
            else:
                logger.warning(f"No SMS sent - recipient: {recipient}, has_response: {bool(response_text)}")
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            logger.error(f"Error type: {type(e).__name__}")
            logger.error(f"Message ID: {message.get('id', 'unknown')}")
            logger.error(f"Phone number: {message.get('phone_number', 'unknown')}")
            logger.error(f"Message content: {message.get('content', 'unknown')[:100]}...")
            
            # Log full traceback for debugging
            import traceback
            logger.error(f"Full traceback:\n{traceback.format_exc()}")
            
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
                        logger.error(f"Rate limit error detected: {str(e)}")
                        error_message = f"Rate limit error: {str(e)}"
                    elif "connection" in str(e).lower() or "network" in str(e).lower():
                        logger.error(f"Connection/Network error detected: {str(e)}")
                        error_message = "I'm having trouble connecting to services. Please try again shortly."
                    else:
                        logger.error(f"Other error type: {str(e)}")
                    
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
        logger.info(f"A2A Worker with MCP support starting (Agent: {A2A_AGENT_ID})")
        
        # Initialize MCP connection
        await self.initialize()
        
        logger.info("Agent Card:")
        logger.info(json.dumps(self.processor.agent_card.to_dict(), indent=2))
        
        while self.running:
            try:
                # Check for morning updates every minute
                if self.morning_update_manager:
                    current_time = datetime.now()
                    # Check once per minute
                    if (self.last_morning_update_check is None or 
                        (current_time - self.last_morning_update_check).seconds >= 60):
                        
                        self.last_morning_update_check = current_time
                        sent_count = await self.morning_update_manager.check_and_send_updates()
                        if sent_count > 0:
                            logger.info(f"Sent {sent_count} morning updates")
                
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
    
    async def cleanup(self):
        """Cleanup resources"""
        if self.processor.mcp_client:
            await self.processor.mcp_client.close()


async def main():
    """Main entry point"""
    worker = A2AWorker()
    
    try:
        await worker.process_loop()
    except KeyboardInterrupt:
        logger.info("Received interrupt, shutting down...")
        worker.stop()
        await worker.cleanup()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        await worker.cleanup()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
