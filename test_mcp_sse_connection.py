#!/usr/bin/env python3
"""
Test script to verify SSE-based MCP connection to openapi-mcp-server
"""

import asyncio
import logging
import sys
import os

# Add agents directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'agents'))

from mcp_sse_client import MCPSSEClient, create_mcp_client

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_mcp_connection():
    """Test connection to MCP server"""
    # Test with local server
    server_url = "http://localhost:3001"
    
    logger.info(f"Testing connection to MCP server at {server_url}")
    
    try:
        # Create and connect client
        client = await create_mcp_client(server_url)
        
        logger.info("✅ Successfully connected to MCP server!")
        logger.info(f"Connected: {client.connected}")
        logger.info(f"Session ID: {client.session_id}")
        logger.info(f"Available tools: {len(client.tools)}")
        
        # List tools
        for tool in client.tools:
            logger.info(f"  - {tool.name}: {tool.description}")
        
        # Test a simple tool call if available
        if client.tools:
            # Try to find a simple tool to test
            test_tool = None
            for tool in client.tools:
                if 'weather' in tool.name.lower() or 'hello' in tool.name.lower():
                    test_tool = tool
                    break
            
            if not test_tool:
                test_tool = client.tools[0]  # Use first available tool
            
            logger.info(f"\n🔧 Testing tool: {test_tool.name}")
            
            # Prepare test arguments based on the tool schema
            test_args = {}
            if test_tool.input_schema.get('properties'):
                # Try to provide minimal required arguments
                for prop_name, prop_schema in test_tool.input_schema['properties'].items():
                    if prop_name in test_tool.input_schema.get('required', []):
                        # Provide a test value based on type
                        if prop_schema.get('type') == 'string':
                            test_args[prop_name] = 'test'
                        elif prop_schema.get('type') == 'number':
                            test_args[prop_name] = 0
                        elif prop_schema.get('type') == 'boolean':
                            test_args[prop_name] = False
            
            logger.info(f"Test arguments: {test_args}")
            
            result = await client.call_tool(test_tool.name, test_args)
            logger.info(f"Tool result: {result}")
        else:
            logger.warning("No tools available to test")
        
        # Close connection
        await client.close()
        logger.info("🔌 Connection closed successfully")
        
    except Exception as e:
        logger.error(f"❌ Connection test failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_mcp_connection())