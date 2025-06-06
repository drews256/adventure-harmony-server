"""
Direct HTTP client for MCP server that handles both SSE and JSON responses
"""

import httpx
import json
import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class MCPTool:
    """MCP Tool definition"""
    name: str
    description: str
    input_schema: Dict[str, Any]


class MCPHTTPClient:
    """Direct HTTP client for MCP server that handles SSE responses"""
    
    def __init__(self, server_url: str, profile_id: Optional[str] = None):
        self.server_url = server_url.rstrip('/')
        self.profile_id = profile_id
        self.session_id = None
        self.tools: List[MCPTool] = []
        
    async def initialize(self):
        """Initialize MCP connection and load tools"""
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Initialize MCP session
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
            
            # Extract session ID from headers if present
            if 'x-mcp-session-id' in response.headers:
                self.session_id = response.headers['x-mcp-session-id']
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
            
            response = await client.post(
                f"{self.server_url}/mcp",
                json=list_tools_data,
                headers=self._get_headers()
            )
            
            tools_result = self._parse_response(response)
            
            if tools_result and "result" in tools_result and "tools" in tools_result["result"]:
                # Convert to MCPTool objects
                for tool_data in tools_result["result"]["tools"]:
                    tool = MCPTool(
                        name=tool_data["name"],
                        description=tool_data.get("description", ""),
                        input_schema=tool_data.get("inputSchema", {})
                    )
                    self.tools.append(tool)
                    
                logger.info(f"Loaded {len(self.tools)} MCP tools")
            else:
                logger.warning("No tools found in MCP response")
                
    def _parse_response(self, response: httpx.Response) -> Dict[str, Any]:
        """Parse MCP response, handling both SSE and JSON formats"""
        if response.status_code != 200:
            raise Exception(f"MCP request failed: {response.status_code} - {response.text}")
            
        # Check if it's SSE format
        if response.text.startswith('event:') or 'text/event-stream' in response.headers.get('content-type', ''):
            # Parse SSE
            for line in response.text.strip().split('\n'):
                if line.startswith('data: '):
                    data_json = line[6:]
                    try:
                        return json.loads(data_json)
                    except json.JSONDecodeError:
                        continue
            raise Exception("No valid JSON found in SSE response")
        else:
            # Parse as regular JSON
            return response.json()
            
    def _get_headers(self) -> Dict[str, str]:
        """Get headers for MCP requests"""
        headers = {"Content-Type": "application/json"}
        if self.session_id:
            headers["x-mcp-session-id"] = self.session_id
        return headers
        
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Call an MCP tool"""
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
                
            response = await client.post(
                f"{self.server_url}/mcp",
                json=call_data,
                headers=self._get_headers()
            )
            
            result = self._parse_response(response)
            
            if "result" in result:
                return result["result"]
            elif "error" in result:
                raise Exception(f"Tool error: {result['error']}")
            else:
                return result
                
    async def close(self):
        """Close the MCP connection"""
        # Nothing to close for HTTP client
        pass


# Factory function
async def create_mcp_http_client(server_url: str, profile_id: Optional[str] = None) -> MCPHTTPClient:
    """Create and initialize MCP HTTP client"""
    client = MCPHTTPClient(server_url, profile_id)
    await client.initialize()
    return client