"""
Agno MCP Tools integration for existing HTTP-based MCP servers
"""

import asyncio
import logging
from typing import List, Dict, Any, Optional, Callable
from agno.tools import Toolkit, Function
from agno.utils.log import log_debug, logger
import httpx
import json

logger = logging.getLogger(__name__)


class HTTPMCPTools(Toolkit):
    """
    MCP Tools implementation that connects to an existing HTTP MCP server
    instead of spawning a new process. Inherits from Agno's Toolkit class.
    """
    
    def __init__(self, server_url: str, profile_id: Optional[str] = None, **kwargs):
        # Initialize base toolkit
        super().__init__(name="HTTPMCPTools", **kwargs)
        
        self.server_url = server_url.rstrip('/')
        self.profile_id = profile_id
        self.session_id = None
        self._initialized = False
        
    async def __aenter__(self):
        """Initialize connection to MCP server"""
        await self.initialize()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Cleanup"""
        pass
        
    async def initialize(self):
        """Connect to MCP server and load tools"""
        if self._initialized:
            return
            
        try:
            # Connect to MCP server and get tools
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Initialize connection
                init_data = {
                    "jsonrpc": "2.0",
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "0.1.0",
                        "capabilities": {},
                        "clientInfo": {
                            "name": "agno-mcp-client",
                            "version": "1.0.0"
                        }
                    },
                    "id": 1
                }
                
                response = await client.post(
                    f"{self.server_url}/mcp",
                    json=init_data,
                    headers={
                        "Content-Type": "application/json",
                        "Accept": "application/json, text/event-stream"
                    }
                )
                
                logger.info(f"MCP init response status: {response.status_code}")
                
                if response.status_code != 200:
                    raise Exception(f"Failed to initialize MCP: {response.status_code} - {response.text}")
                
                # Extract session ID from headers if present
                if 'x-mcp-session-id' in response.headers:
                    self.session_id = response.headers['x-mcp-session-id']
                    logger.info(f"Got MCP session ID: {self.session_id}")
                elif 'mcp-session-id' in response.headers:
                    self.session_id = response.headers['mcp-session-id']
                    logger.info(f"Got MCP session ID: {self.session_id}")
                
                # Parse init response
                init_result = self._parse_response(response)
                logger.info(f"MCP initialized: {init_result}")
                
                # List tools
                list_tools_data = {
                    "jsonrpc": "2.0",
                    "method": "tools/list",
                    "params": {"profileId": self.profile_id} if self.profile_id else {},
                    "id": 2
                }
                
                headers = {
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream"
                }
                if self.session_id:
                    headers["x-mcp-session-id"] = self.session_id
                
                response = await client.post(
                    f"{self.server_url}/mcp",
                    json=list_tools_data,
                    headers=headers
                )
                
                if response.status_code != 200:
                    raise Exception(f"Failed to list tools: {response.status_code} - {response.text}")
                
                tools_result = self._parse_response(response)
                
                if "result" in tools_result and "tools" in tools_result["result"]:
                    # Register tools with the toolkit using Function objects
                    for tool_data in tools_result["result"]["tools"]:
                        tool_name = tool_data["name"]
                        
                        # Create an entrypoint function for this tool
                        async def tool_entrypoint(**kwargs):
                            # Extract tool name from closure
                            _tool_name = tool_name
                            return await self._call_tool(_tool_name, kwargs)
                        
                        # Create a proper closure to capture tool_name
                        tool_entrypoint = self._create_tool_entrypoint(tool_name)
                        
                        # Create a Function object following Agno's pattern
                        function = Function(
                            name=tool_name,
                            description=tool_data.get("description", ""),
                            parameters=tool_data.get("inputSchema", {"type": "object", "properties": {}}),
                            entrypoint=tool_entrypoint,
                            # Skip processing since we provide the schema directly
                            skip_entrypoint_processing=True
                        )
                        
                        # Register the function with the toolkit
                        self.functions[tool_name] = function
                        log_debug(f"Registered MCP tool: {tool_name}")
                    
                    logger.info(f"Loaded {len(self.functions)} MCP tools")
                else:
                    logger.warning("No tools found in MCP response")
                    
            self._initialized = True
            
        except Exception as e:
            logger.error(f"Failed to initialize MCP tools: {e}")
            raise
    
    def _create_tool_entrypoint(self, tool_name: str) -> Callable:
        """Create a tool entrypoint function with proper closure"""
        async def entrypoint(**kwargs):
            return await self._call_tool(tool_name, kwargs)
        
        # Set function name for better debugging
        entrypoint.__name__ = tool_name
        return entrypoint
    
    def _parse_response(self, response: httpx.Response) -> Dict[str, Any]:
        """Parse MCP response, handling both SSE and JSON formats"""
        # Check content type
        content_type = response.headers.get('content-type', '')
        
        # If it's JSON, parse directly
        if 'application/json' in content_type:
            return response.json()
        
        # If it's SSE or text starts with event:
        if 'text/event-stream' in content_type or response.text.startswith('event:'):
            # Parse SSE format
            for line in response.text.strip().split('\n'):
                if line.startswith('data: '):
                    data_json = line[6:]  # Remove 'data: ' prefix
                    try:
                        return json.loads(data_json)
                    except json.JSONDecodeError:
                        continue
            raise Exception("No valid JSON found in SSE response")
        
        # Try to parse as JSON anyway
        try:
            return response.json()
        except Exception:
            raise Exception(f"Unable to parse response: {response.text[:500]}")
            
    async def _call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Call a specific MCP tool"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            call_data = {
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                },
                "id": 3
            }
            
            if self.profile_id:
                call_data["params"]["profileId"] = self.profile_id
            
            headers = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream"
            }
            if self.session_id:
                headers["x-mcp-session-id"] = self.session_id
                
            response = await client.post(
                f"{self.server_url}/mcp",
                json=call_data,
                headers=headers
            )
            
            if response.status_code != 200:
                raise Exception(f"Tool call failed: {response.status_code} - {response.text}")
            
            result = self._parse_response(response)
            
            if "result" in result:
                return result["result"]
            elif "error" in result:
                raise Exception(f"Tool error: {result['error']}")
            else:
                return result


async def create_http_mcp_tools(server_url: str, profile_id: Optional[str] = None) -> HTTPMCPTools:
    """Create and initialize HTTP MCP tools"""
    tools = HTTPMCPTools(server_url, profile_id)
    await tools.initialize()
    return tools