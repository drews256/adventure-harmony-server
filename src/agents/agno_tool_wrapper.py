"""
Wrapper to convert MCP tools to Agno-compatible format
"""

from typing import Dict, Any, Optional
import json
import logging

logger = logging.getLogger(__name__)


def create_agno_tool(name: str, description: str, schema: Dict[str, Any], func):
    """
    Create an Agno-compatible tool from an MCP tool
    
    Agno expects tools to either be:
    1. Functions with proper type hints
    2. Functions with __agno_params__ attribute containing parameter descriptions
    """
    
    # Convert MCP schema to Agno parameter format
    params = {}
    
    if schema and isinstance(schema, dict):
        properties = schema.get('properties', {})
        required = schema.get('required', [])
        
        for param_name, param_spec in properties.items():
            param_info = {
                "description": param_spec.get('description', ''),
                "type": param_spec.get('type', 'string'),
                "required": param_name in required
            }
            
            # Add additional schema info if present
            if 'enum' in param_spec:
                param_info['enum'] = param_spec['enum']
            if 'default' in param_spec:
                param_info['default'] = param_spec['default']
                
            params[param_name] = param_info
    
    # Attach Agno metadata to the function
    func.__agno_name__ = name
    func.__agno_description__ = description
    func.__agno_params__ = params
    
    # Also keep the original schema for reference
    func.__mcp_schema__ = schema
    
    logger.debug(f"Created Agno tool '{name}' with params: {params}")
    
    return func