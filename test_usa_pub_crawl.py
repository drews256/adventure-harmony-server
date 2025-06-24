#!/usr/bin/env python3
"""
Test USA Pub Crawl booking with different ticket structures

Usage:
    OCTO_API_TOKEN=your-token python test_usa_pub_crawl.py
"""

import os
import json
import requests
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List

# Configuration
MCP_SERVER_URL = os.getenv('MCP_SERVER_URL', 'http://localhost:3001')
OCTO_API_TOKEN = os.getenv('OCTO_API_TOKEN')

if not OCTO_API_TOKEN:
    print('❌ Error: OCTO_API_TOKEN environment variable is required')
    print('Usage: OCTO_API_TOKEN=your-token python test_usa_pub_crawl.py')
    exit(1)


def call_mcp_tool(tool_name: str, args: Dict[str, Any]) -> Any:
    """Call an MCP tool through the server"""
    print(f"\n📞 Calling {tool_name}...")
    
    request_body = {
        'jsonrpc': '2.0',
        'method': 'tools/call',
        'params': {
            'name': tool_name,
            'arguments': {
                **args,
                'authToken': OCTO_API_TOKEN,
            }
        },
        'id': int(datetime.now().timestamp() * 1000)
    }
    
    response = requests.post(
        f"{MCP_SERVER_URL}/mcp",
        json=request_body,
        headers={'Content-Type': 'application/json'}
    )
    
    result = response.json()
    
    if 'error' in result:
        raise Exception(f"MCP Error: {json.dumps(result['error'])}")
    
    return json.loads(result['result']['content'][0]['text'])


def test_usa_pub_crawl():
    """Run the USA Pub Crawl booking test"""
    print('🧪 USA Pub Crawl Booking Test')
    print('============================')
    print(f'MCP Server: {MCP_SERVER_URL}')
    print(f'Token: {OCTO_API_TOKEN[:10]}...')
    
    # Step 1: Find USA Pub Crawl product
    print('\n📍 Step 1: Finding USA Pub Crawl product...')
    products = call_mcp_tool('octo_list_products', {
        'Octo-Capabilities': 'octo/content'
    })
    
    # Find pub crawl product
    pub_crawl = None
    for product in products:
        name = (product.get('internalName', '') or 
                product.get('title', '') or 
                product.get('name', '')).lower()
        if 'pub crawl' in name:
            pub_crawl = product
            break
    
    if not pub_crawl:
        raise Exception('USA Pub Crawl product not found!')
    
    product_id = pub_crawl['id']
    option_id = pub_crawl.get('options', [{}])[0].get('id', 'DEFAULT')
    units = pub_crawl.get('options', [{}])[0].get('units', [])
    unit_ids = [unit['id'] for unit in units]
    
    print(f'\n✅ Found USA Pub Crawl:')
    print(f'   Product ID: {product_id}')
    print(f'   Product Name: {pub_crawl.get("internalName", "Unknown")}')
    print(f'   Option ID: {option_id}')
    print(f'   Unit IDs: {json.dumps(unit_ids)}')
    print(f'   Units Details:')
    for unit in units:
        print(f'     - {unit["id"]}: {unit.get("internalName", "Unknown")} ({unit.get("type", "Unknown")})')
    
    # Step 2: Check availability
    print('\n📅 Step 2: Checking availability for tomorrow...')
    tomorrow = datetime.now() + timedelta(days=1)
    date_str = tomorrow.strftime('%Y-%m-%d')
    
    availability = call_mcp_tool('octo_check_availability', {
        'productId': product_id,
        'optionId': option_id,
        'localDateStart': date_str,
        'localDateEnd': date_str,
        'units': [{
            'id': unit_ids[0],
            'quantity': 2
        }],
        'Octo-Capabilities': 'octo/content'
    })
    
    print('\n📋 Availability response (first 3 slots):')
    print(json.dumps(availability[:3], indent=2))
    
    # Find available slot
    available_slot = next((slot for slot in availability if slot.get('available')), None)
    if not available_slot:
        raise Exception('No available slots found!')
    
    availability_id = available_slot['id']
    print(f'\n✅ Found available slot: {availability_id}')
    
    # Step 3: Try different booking structures
    print('\n🎫 Step 3: Testing booking structures...')
    
    base_booking_data = {
        'productId': product_id,
        'optionId': option_id,
        'availabilityId': availability_id,
        'notes': 'Test booking for USA Pub Crawl debugging',
        'Octo-Capabilities': 'octo/content'
    }
    
    # Different ticket structures to try
    structures = [
        {
            'name': 'Correct unitItems format (2 tickets)',
            'unitItems': [
                {'unitId': unit_ids[0]},
                {'unitId': unit_ids[0]}
            ]
        },
        {
            'name': 'unitItems with UUID for idempotency',
            'unitItems': [
                {'unitId': unit_ids[0], 'uuid': str(uuid.uuid4())},
                {'unitId': unit_ids[0], 'uuid': str(uuid.uuid4())}
            ]
        },
        {
            'name': 'Single unitItem',
            'unitItems': [
                {'unitId': unit_ids[0]}
            ]
        },
        {
            'name': 'Three unitItems',
            'unitItems': [
                {'unitId': unit_ids[0]},
                {'unitId': unit_ids[0]},
                {'unitId': unit_ids[0]}
            ]
        }
    ]
    
    # Try each structure
    for i, structure in enumerate(structures):
        print(f'\n🔄 Attempt {i + 1}: {structure["name"]}')
        
        try:
            booking_data = {**base_booking_data, **structure}
            
            print(f'Booking request units: {json.dumps(booking_data["units"], indent=2)}')
            if 'tickets' in booking_data and booking_data['tickets']:
                print(f'Booking request tickets: {json.dumps(booking_data["tickets"], indent=2)}')
            
            booking = call_mcp_tool('octo_create_booking', booking_data)
            
            print(f'\n🎉 SUCCESS with structure: {structure["name"]}')
            print(f'Booking response: {json.dumps(booking, indent=2)}')
            
            # Success! We can stop trying
            return True
            
        except Exception as e:
            error_msg = str(e)
            print(f'❌ Failed: {error_msg}')
            
            # Try to extract detailed error
            if 'MCP Error:' in error_msg:
                try:
                    error_data = json.loads(error_msg.replace('MCP Error: ', ''))
                    if 'message' in error_data:
                        error_detail = json.loads(error_data['message'])
                        print(f'   Error details: {error_detail.get("errorMessage", error_detail)}')
                except:
                    pass
    
    print('\n❌ All booking structures failed!')
    print('The USA Pub Crawl may have specific requirements not covered by these structures.')
    return False


if __name__ == '__main__':
    try:
        success = test_usa_pub_crawl()
        if success:
            print('\n✅ Test completed successfully')
        else:
            print('\n⚠️  Test completed but booking failed')
            exit(1)
    except Exception as e:
        print(f'\n❌ Test failed: {e}')
        exit(1)