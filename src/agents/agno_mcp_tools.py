"""
Agno MCP Tools integration for existing HTTP-based MCP servers
"""

import asyncio
import logging
from typing import List, Dict, Any, Optional
from agno.tools.mcp import MCPTools
import httpx
import json

logger = logging.getLogger(__name__)


class HTTPMCPTools(MCPTools):
    """
    MCP Tools implementation that connects to an existing HTTP MCP server
    instead of spawning a new process
    """
    
    def __init__(self, server_url: str, profile_id: Optional[str] = None):
        self.server_url = server_url
        self.profile_id = profile_id
        self.tools = []
        self._initialized = False
        
    async def __aenter__(self):
        """Initialize connection to MCP server"""
        await self._initialize()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Cleanup"""
        pass
        
    async def _initialize(self):
        """Connect to MCP server and load tools"""
        if self._initialized:
            return
            
        try:
            # Connect to MCP server and get tools
            async with httpx.AsyncClient() as client:
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
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code != 200:
                    raise Exception(f"Failed to initialize MCP: {response.status_code}")
                
                # List tools
                list_tools_data = {
                    "jsonrpc": "2.0",
                    "method": "tools/list",
                    "params": {"profileId": self.profile_id} if self.profile_id else {},
                    "id": 2
                }
                
                response = await client.post(
                    f"{self.server_url}/mcp",
                    json=list_tools_data,
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code != 200:
                    raise Exception(f"Failed to list tools: {response.status_code}")
                
                result = response.json()
                if "result" in result and "tools" in result["result"]:
                    self.tools = result["result"]["tools"]
                    logger.info(f"Loaded {len(self.tools)} MCP tools")
                else:
                    logger.warning("No tools found in MCP response")
                    
            self._initialized = True
            
        except Exception as e:
            logger.error(f"Failed to initialize MCP tools: {e}")
            raise
            
    def get_tools(self) -> List[Any]:
        """Get list of available tools"""
        # Return self - Agno will handle tool discovery
        return [self]
        
    async def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Return tool schemas for Agno"""
        schemas = []
        for tool in self.tools:
            # Ensure schema is valid
            schema = tool.get("inputSchema", {})
            if isinstance(schema, dict):
                # Ensure it has a type field
                if "type" not in schema and "properties" in schema:
                    schema["type"] = "object"
                    
            schemas.append({
                "name": tool["name"],
                "description": tool.get("description", ""),
                "input_schema": schema
            })
        return schemas
        
    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call a tool by name - this method is called by Agno"""
        return await self._call_tool(name, arguments)
        
    async def _call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Call a specific MCP tool"""
        async with httpx.AsyncClient() as client:
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
            
            response = await client.post(
                f"{self.server_url}/mcp",
                json=call_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code != 200:
                raise Exception(f"Tool call failed: {response.status_code}")
            
            result = response.json()
            if "result" in result:
                return result["result"]
            elif "error" in result:
                raise Exception(f"Tool error: {result['error']}")
            else:
                return result


async def create_http_mcp_tools(server_url: str, profile_id: Optional[str] = None) -> HTTPMCPTools:
    """Create and initialize HTTP MCP tools"""
    tools = HTTPMCPTools(server_url, profile_id)
    await tools._initialize()
    return tools