#!/usr/bin/env python3
"""
Simple A2A client for testing the A2A worker
Demonstrates how to interact with the A2A protocol
"""

import asyncio
import json
import uuid
from typing import Dict, Any

# Example A2A client implementation
class A2AClient:
    """Simple A2A client for testing"""
    
    async def send_request(self, method: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Send an A2A request (in a real implementation, this would use HTTP/WebSocket)"""
        request = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": method
        }
        if params:
            request["params"] = params
        
        print(f"\nSending A2A Request:")
        print(json.dumps(request, indent=2))
        
        # In a real implementation, this would send over network
        # For testing, we just return a mock response
        return request

async def main():
    """Test A2A interactions"""
    client = A2AClient()
    
    print("=== A2A Protocol Test Client ===\n")
    
    # 1. Agent Discovery
    print("1. Testing Agent Discovery:")
    await client.send_request("agent.discover")
    
    # 2. Tool Execution - Calendar
    print("\n2. Testing Calendar Tool:")
    await client.send_request("tool.execute", {
        "tool": "calendar_display",
        "params": {
            "year": 2025,
            "month": 5,
            "events": [
                {"date": "2025-05-15", "title": "Team Meeting", "description": "Monthly sync"},
                {"date": "2025-05-20", "title": "Project Demo", "description": "Client presentation"}
            ]
        },
        "context": {
            "conversation_id": "test-conv-123"
        }
    })
    
    # 3. Tool Execution - Form
    print("\n3. Testing Form Tool:")
    await client.send_request("tool.execute", {
        "tool": "dynamic_form",
        "params": {
            "title": "Contact Information",
            "fields": [
                {"name": "name", "type": "text", "label": "Full Name", "required": True},
                {"name": "email", "type": "email", "label": "Email", "required": True},
                {"name": "phone", "type": "tel", "label": "Phone", "required": False}
            ]
        },
        "context": {
            "conversation_id": "test-conv-123"
        }
    })
    
    # 4. Message Processing
    print("\n4. Testing Message Processing:")
    await client.send_request("message.process", {
        "content": "I need help scheduling a meeting next week",
        "history": [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi! How can I help you today?"}
        ],
        "conversation_id": "test-conv-123",
        "from_number": "+1234567890"
    })
    
    # 5. Help Request
    print("\n5. Testing Help Request Tool:")
    await client.send_request("tool.execute", {
        "tool": "help_request",
        "params": {
            "category": "technical",
            "urgency": "high",
            "description": "Cannot access my account"
        },
        "context": {
            "conversation_id": "test-conv-123"
        }
    })
    
    print("\n=== Test Complete ===")
    print("\nNote: This is a test client showing A2A request formats.")
    print("In production, these would be sent to the A2A worker via HTTP/WebSocket.")

if __name__ == "__main__":
    asyncio.run(main())