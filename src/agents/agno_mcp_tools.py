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
        
        logger.info(f"HTTPMCPTools initialized with profile_id: {repr(profile_id)}")
        
    async def __aenter__(self):
        """Initialize connection to MCP server"""
        await self.initialize()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Cleanup"""
        pass
        
    async def initialize(self):
        """Connect to MCP server and load tools"""
        # Always re-initialize to get fresh tools
        self._initialized = False
        self.functions = {}  # Clear any existing functions
            
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
                    "params": {},
                    "id": 2
                }
                
                # Add profileId to params if available
                if self.profile_id:
                    list_tools_data["params"]["profileId"] = self.profile_id
                
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
                logger.info(f"Tools list response: {json.dumps(tools_result, indent=2)}")
                
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
                        
                        # Get the input schema
                        input_schema = tool_data.get("inputSchema", {"type": "object", "properties": {}})
                        
                        # Log the full tool schema for debugging
                        logger.info(f"Tool {tool_name} full schema before modification: {json.dumps(input_schema, indent=2)}")
                        
                        # Check for problematic parameters in the schema and remove defaults
                        if "properties" in input_schema:
                            # Check authToken
                            if "authToken" in input_schema["properties"]:
                                auth_token_prop = input_schema["properties"]["authToken"]
                                logger.warning(f"Tool {tool_name} has authToken in schema: {auth_token_prop}")
                                if isinstance(auth_token_prop, dict) and auth_token_prop.get("default") == "token":
                                    logger.warning(f"Tool {tool_name} has authToken with default='token' - removing default")
                                    auth_token_prop.pop("default", None)
                            
                            # Check credentialName  
                            if "credentialName" in input_schema["properties"]:
                                cred_prop = input_schema["properties"]["credentialName"]
                                logger.warning(f"Tool {tool_name} has credentialName in schema: {cred_prop}")
                                if isinstance(cred_prop, dict) and cred_prop.get("default") == "default":
                                    logger.warning(f"Tool {tool_name} has credentialName with default='default' - removing default")
                                    cred_prop.pop("default", None)
                            
                            # Check tenant
                            if "tenant" in input_schema["properties"]:
                                tenant_prop = input_schema["properties"]["tenant"]
                                logger.warning(f"Tool {tool_name} has tenant in schema: {tenant_prop}")
                                if isinstance(tenant_prop, dict) and tenant_prop.get("default") == "default":
                                    logger.warning(f"Tool {tool_name} has tenant with default='default' - removing default")
                                    tenant_prop.pop("default", None)
                        
                        # Remove profileId from schema if present - it's handled separately
                        if "properties" in input_schema and "profileId" in input_schema["properties"]:
                            input_schema["properties"].pop("profileId", None)
                            logger.info(f"Removed profileId from {tool_name} schema - will be handled automatically")
                        
                        # Create a Function object following Agno's pattern
                        function = Function(
                            name=tool_name,
                            description=tool_data.get("description", ""),
                            parameters=input_schema,
                            entrypoint=tool_entrypoint,
                            # Skip processing since we provide the schema directly
                            skip_entrypoint_processing=True
                        )
                        
                        # Register the function with the toolkit
                        self.functions[tool_name] = function
                        logger.info(f"Registered MCP tool: {tool_name}")
                        logger.info(f"  Description: {tool_data.get('description', 'No description')}")
                        logger.info(f"  Schema: {json.dumps(input_schema, indent=2)}")
                    
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
            logger.info(f"Tool entrypoint called: {tool_name}")
            logger.info(f"Tool arguments from Agno: {json.dumps(kwargs, indent=2)}")
            
            # Check for problematic default values added by Agno and remove them
            if 'authToken' in kwargs:
                logger.warning(f"authToken found in arguments from Agno: {kwargs['authToken']}")
                # Remove it if it's the default "token" value
                if kwargs['authToken'] == 'token':
                    logger.warning("Removing default authToken='token' from arguments")
                    kwargs.pop('authToken', None)
            
            if 'credentialName' in kwargs:
                logger.warning(f"credentialName found in arguments from Agno: {kwargs['credentialName']}")
                if kwargs['credentialName'] == 'default':
                    logger.warning("Removing default credentialName='default' from arguments")
                    kwargs.pop('credentialName', None)
            
            if 'tenant' in kwargs:
                logger.warning(f"tenant found in arguments from Agno: {kwargs['tenant']}")
                if kwargs['tenant'] == 'default':
                    logger.warning("Removing default tenant='default' from arguments")
                    kwargs.pop('tenant', None)
            
            # Always ensure profileId is included if we have one
            if self.profile_id and 'profileId' not in kwargs:
                kwargs['profileId'] = self.profile_id
                logger.info(f"Added instance profile_id to arguments: {self.profile_id}")
            
            result = await self._call_tool(tool_name, kwargs)
            logger.info(f"Tool {tool_name} result: {json.dumps(result, indent=2) if isinstance(result, (dict, list)) else str(result)}")
            return result
        
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
        logger.info(f"=== MCP Tool Call: {tool_name} ===")
        logger.info(f"Raw arguments: {json.dumps(arguments, indent=2)}")
        
        # Transform units parameter to array if needed for OCTO API calls
        # This is specifically for OCTO API tools like octo_search_availability and octo_create_booking
        if 'units' in arguments:
            original_units = arguments['units']
            logger.info(f"[UNITS TRANSFORM] Original units value: {json.dumps(original_units, indent=2)}")
            logger.info(f"[UNITS TRANSFORM] Original units type: {type(original_units)}")
            
            if not isinstance(arguments['units'], list):
                logger.warning(f"[UNITS TRANSFORM] Units is not a list! Type: {type(arguments['units'])}")
                # Handle different cases:
                # 1. If it's None or empty, make it an empty array
                if not arguments['units']:
                    arguments['units'] = []
                    logger.info("[UNITS TRANSFORM] Converted None/empty to empty array")
                # 2. If it's a dict (single unit object), wrap it in an array
                elif isinstance(arguments['units'], dict):
                    arguments['units'] = [arguments['units']]
                    logger.info("[UNITS TRANSFORM] Wrapped dict in array")
                # 3. If it's a string, try to parse it as JSON first
                elif isinstance(arguments['units'], str):
                    try:
                        import json as json_module
                        parsed = json_module.loads(arguments['units'])
                        if isinstance(parsed, list):
                            arguments['units'] = parsed
                            logger.info("[UNITS TRANSFORM] Parsed string as JSON array")
                        else:
                            arguments['units'] = [parsed]
                            logger.info("[UNITS TRANSFORM] Parsed string as JSON object and wrapped in array")
                    except Exception as e:
                        logger.error(f"[UNITS TRANSFORM] Failed to parse units string: {arguments['units']}, error: {e}")
                        arguments['units'] = []
                # 4. For any other type, wrap in array
                else:
                    arguments['units'] = [arguments['units']]
                    logger.info(f"[UNITS TRANSFORM] Wrapped {type(original_units)} in array")
                logger.info(f"[UNITS TRANSFORM] Final units value: {json.dumps(arguments['units'], indent=2)}")
            else:
                logger.info("[UNITS TRANSFORM] Units is already an array, no transformation needed")
        
        # Also check if we're calling an OCTO-specific tool and log it
        if tool_name and 'octo' in tool_name.lower():
            logger.info(f"Calling OCTO API tool: {tool_name}")
            if 'units' in arguments:
                logger.info(f"Units parameter for OCTO API: {json.dumps(arguments['units'], indent=2)}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Extract profileId from arguments if present, otherwise use instance profile_id
            from_args = 'profileId' in arguments
            profile_id = arguments.pop('profileId', self.profile_id) if from_args else self.profile_id
            logger.info(f"Profile ID for call: {repr(profile_id)} (from args: {from_args}, instance: {repr(self.profile_id)})")
            
            # Log the final arguments that will be sent
            logger.info(f"[FINAL ARGUMENTS] About to send to MCP server: {json.dumps(arguments, indent=2)}")
            if 'units' in arguments:
                logger.info(f"[FINAL UNITS CHECK] units type: {type(arguments['units'])}, value: {arguments['units']}")
            
            call_data = {
                "jsonrpc": "2.0",
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": arguments
                },
                "id": 3
            }
            
            # Add profileId to params (not arguments) - consistent with tools/list
            if profile_id:
                call_data["params"]["profileId"] = profile_id
            
            logger.info(f"MCP call data: {json.dumps(call_data, indent=2)}")
            
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
            
            logger.info(f"MCP response status: {response.status_code}")
            
            if response.status_code != 200:
                logger.error(f"Tool call failed: {response.text}")
                raise Exception(f"Tool call failed: {response.status_code} - {response.text}")
            
            result = self._parse_response(response)
            logger.info(f"MCP parsed response: {json.dumps(result, indent=2) if isinstance(result, (dict, list)) else str(result)}")
            
            if "result" in result:
                logger.info(f"=== End MCP Tool Call: {tool_name} (success) ===")
                return result["result"]
            elif "error" in result:
                logger.error(f"Tool error: {result['error']}")
                raise Exception(f"Tool error: {result['error']}")
            else:
                logger.info(f"=== End MCP Tool Call: {tool_name} (raw result) ===")
                return result


async def create_http_mcp_tools(server_url: str, profile_id: Optional[str] = None) -> HTTPMCPTools:
    """Create and initialize HTTP MCP tools"""
    tools = HTTPMCPTools(server_url, profile_id)
    await tools.initialize()
    return tools