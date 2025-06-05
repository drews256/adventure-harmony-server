"""
SSE-based MCP Client for Python

This client connects to MCP servers using Server-Sent Events (SSE) transport,
following the Model Context Protocol specification.
"""

import json
import logging
import time
import asyncio
from typing import Dict, List, Any, Optional, AsyncIterator
from dataclasses import dataclass
from enum import Enum

import httpx
from httpx_sse import aconnect_sse

logger = logging.getLogger(__name__)


class MCPMessageType(str, Enum):
    """MCP message types"""
    REQUEST = "request"
    RESPONSE = "response"
    NOTIFICATION = "notification"
    ERROR = "error"


@dataclass
class MCPTool:
    """MCP Tool definition"""
    name: str
    description: str
    input_schema: Dict[str, Any]


class MCPSSEClient:
    """MCP Client using SSE (Server-Sent Events) transport"""
    
    def __init__(self, server_url: str):
        """
        Initialize MCP SSE client
        
        Args:
            server_url: Base URL of the MCP server (e.g., http://localhost:3001)
        """
        self.server_url = server_url.rstrip('/')
        self.endpoint = f"{self.server_url}/mcp"
        self.session_id = None
        self.tools: List[MCPTool] = []
        self.connected = False
        self._request_id_counter = 0
        self._pending_responses: Dict[str, asyncio.Future] = {}
        self._sse_task = None
        self._http_client = None
        
    async def connect(self, retry_count: int = 3, retry_delay: int = 2):
        """
        Connect to MCP server and initialize session
        
        Args:
            retry_count: Number of connection attempts
            retry_delay: Delay in seconds between retries
        """
        import httpx
        
        for attempt in range(retry_count):
            try:
                logger.info(f"🔗 Connecting to MCP server at {self.endpoint} (attempt {attempt + 1}/{retry_count})")
                logger.debug(f"Full server URL: {self.server_url}, Endpoint: {self.endpoint}")
                
                # Create HTTP client with proper headers and timeout
                self._http_client = httpx.AsyncClient(
                    headers={
                        'Accept': 'text/event-stream',
                        'Cache-Control': 'no-cache'
                    },
                    timeout=httpx.Timeout(30.0, connect=5.0)
                )
                
                # Send initialize request
                await self._initialize()
                
                # Send initialized notification
                await self._send_initialized()
                
                # Get available tools
                await self.refresh_tools()
                
                self.connected = True
                logger.info("✅ Successfully connected to MCP server via SSE")
                return
                
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                logger.warning(f"⚠️  Connection attempt {attempt + 1} failed: {e}")
                if attempt < retry_count - 1:
                    logger.info(f"⏳ Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error(f"💥 All connection attempts failed. Is the MCP server running at {self.server_url}?")
                    self.connected = False
                    raise ConnectionError(f"Failed to connect to MCP server at {self.server_url} after {retry_count} attempts")
            except Exception as e:
                logger.error(f"💥 Unexpected error connecting to MCP: {e}")
                self.connected = False
                raise
    
    def _get_next_request_id(self) -> str:
        """Generate unique request ID"""
        self._request_id_counter += 1
        return f"req_{self._request_id_counter}_{int(time.time() * 1000)}"
    
    async def _send_request(self, method: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Send request to MCP server and wait for response"""
        request_id = self._get_next_request_id()
        
        request_data = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params or {}
        }
        
        # Add session ID if we have one
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        }
        if self.session_id:
            headers['x-mcp-session-id'] = self.session_id
        
        logger.debug(f"📤 Sending {method} request: {request_data}")
        
        # Send POST request with SSE response
        async with aconnect_sse(
            self._http_client, 
            'POST', 
            self.endpoint,
            json=request_data,
            headers=headers
        ) as event_source:
            async for sse in event_source.aiter_sse():
                if sse.event == 'message':
                    try:
                        response = json.loads(sse.data)
                        logger.debug(f"📥 Received response: {response}")
                        
                        # Extract session ID from response if present
                        if 'sessionId' in response:
                            self.session_id = response['sessionId']
                            logger.debug(f"🔑 Session ID: {self.session_id}")
                        
                        # Check if this is our response
                        if response.get('id') == request_id:
                            if 'error' in response:
                                raise Exception(f"MCP error: {response['error']}")
                            return response.get('result', {})
                            
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse SSE data: {sse.data}")
                        raise e
        
        raise Exception(f"No response received for request {request_id}")
    
    async def _send_notification(self, method: str, params: Dict[str, Any] = None):
        """Send notification to MCP server (no response expected)"""
        notification_data = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params or {}
        }
        
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
        }
        if self.session_id:
            headers['x-mcp-session-id'] = self.session_id
        
        logger.debug(f"📤 Sending {method} notification: {notification_data}")
        
        # Send POST request without waiting for specific response
        response = await self._http_client.post(
            self.endpoint,
            json=notification_data,
            headers=headers
        )
        
        if response.status_code != 200:
            logger.warning(f"Notification {method} returned status {response.status_code}")
    
    async def _initialize(self):
        """Send initialize request"""
        result = await self._send_request(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {
                    "textCompletion": True,
                    "toolCalls": True
                },
                "clientInfo": {
                    "name": "Adventure Harmony MCP Client",
                    "version": "1.0.0"
                }
            }
        )
        
        logger.info(f"🔧 Server info: {result.get('serverInfo', 'N/A')}")
        logger.info(f"📋 Protocol version: {result.get('protocolVersion', 'N/A')}")
        logger.info(f"🔧 Capabilities: {result.get('capabilities', 'N/A')}")
    
    async def _send_initialized(self):
        """Send initialized notification"""
        await self._send_notification("initialized")
        logger.debug("✅ Sent initialized notification")
    
    async def refresh_tools(self):
        """Get available tools from MCP server"""
        try:
            logger.info("🔧 Fetching tools from MCP server")
            
            result = await self._send_request("tools/list")
            tools_list = result.get('tools', [])
            
            self.tools = []
            for tool in tools_list:
                mcp_tool = MCPTool(
                    name=tool.get("name", ""),
                    description=tool.get("description", ""),
                    input_schema=tool.get("inputSchema", {"type": "object"})
                )
                self.tools.append(mcp_tool)
            
            logger.info(f"✅ Retrieved {len(self.tools)} tools from MCP server")
            
            # Log each tool
            for i, tool in enumerate(self.tools):
                logger.info(f"  🔧 Tool {i+1}: {tool.name} - {tool.description}")
                logger.debug(f"     📋 Schema: {tool.input_schema}")
            
            if len(self.tools) == 0:
                logger.warning("⚠️  No tools returned from MCP server")
                
        except Exception as e:
            logger.error(f"💥 Error getting tools from MCP: {e}")
            raise
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool through MCP"""
        try:
            if not self.connected:
                raise Exception("Not connected to MCP server")
            
            logger.info(f"🔧 Calling tool: {tool_name}")
            logger.debug(f"   Tool arguments: {json.dumps(arguments, indent=2)}")
            
            result = await self._send_request(
                "tools/call",
                {
                    "name": tool_name,
                    "arguments": arguments
                }
            )
            
            logger.debug(f"📥 Tool result: {result}")
            
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
                
        except Exception as e:
            logger.error(f"💥 Error calling MCP tool {tool_name}: {e}")
            return {"error": str(e)}
    
    async def close(self):
        """Close MCP connection"""
        try:
            if self._http_client:
                await self._http_client.aclose()
                
            self.connected = False
            self.session_id = None
            logger.info("🔌 MCP connection closed")
            
        except Exception as e:
            logger.error(f"Error closing MCP connection: {e}")


# Convenience function to create and connect client
async def create_mcp_client(server_url: str, retry_count: int = 3, retry_delay: int = 2) -> MCPSSEClient:
    """
    Create and connect MCP SSE client
    
    Args:
        server_url: Base URL of the MCP server
        retry_count: Number of connection attempts
        retry_delay: Delay in seconds between retries
    """
    client = MCPSSEClient(server_url)
    await client.connect(retry_count=retry_count, retry_delay=retry_delay)
    return client