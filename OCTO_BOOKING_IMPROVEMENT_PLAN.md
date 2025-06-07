# OCTO Booking Improvement Plan

## Current Problem Analysis

The persistent error `"Validation failed: Bookings[0] tickets at least one ticket is required"` indicates that:

1. The tickets structure we're sending might not be correct for this specific supplier
2. Different OCTO suppliers may have different requirements for the tickets field
3. The agent needs better error handling and adaptive booking strategies

## Current Documentation Summary

### What We Know:
1. **Headers Required**: `Octo-Capabilities: octo/content`
2. **Booking Flow**: Products → Availability → Booking
3. **AvailabilityId**: The `id` field from availability response (date format)
4. **Tickets**: Should be nested in units array as `tickets: [{}, {}]`

### The Problem:
Despite following the documented structure, we're still getting tickets validation errors.

## Proposed Solutions

### Solution 1: Enhanced Error Detection and Retry Strategy

Create a smarter booking approach that:
1. First attempts booking with the standard structure
2. If it fails with tickets error, tries alternative structures
3. Learns from errors and adapts

### Solution 2: Create a Booking Helper Tool

Instead of relying on the agent to construct complex booking requests, create a dedicated tool that:
1. Takes simple parameters (product, date, people)
2. Handles all the complexity internally
3. Manages retries with different structures

### Solution 3: Enhanced Agent Instructions with Error Patterns

Teach the agent to recognize and handle different error patterns:

```python
BOOKING_ERROR_HANDLERS = {
    "tickets at least one ticket is required": {
        "action": "add_detailed_tickets",
        "description": "Add ticket objects with unit reference"
    },
    "Field availabilityId is required": {
        "action": "use_id_from_availability",
        "description": "Use the 'id' field from availability response"
    },
    "Invalid unit ID": {
        "action": "get_exact_unit_id",
        "description": "Use exact unit ID from products response"
    }
}
```

## Recommended Implementation Plan

### Phase 1: Immediate Fix - Enhanced Instructions

Update agent instructions to try multiple ticket structures:

```json
// Structure 1: Empty ticket objects
{
  "units": [{
    "id": "unit_id",
    "quantity": 2,
    "tickets": [{}, {}]
  }]
}

// Structure 2: Tickets with unit reference
{
  "units": [{
    "id": "unit_id",
    "quantity": 2,
    "tickets": [
      {"unitId": "unit_id"},
      {"unitId": "unit_id"}
    ]
  }]
}

// Structure 3: No tickets field (some suppliers)
{
  "units": [{
    "id": "unit_id",
    "quantity": 2
  }]
}
```

### Phase 2: Add Retry Logic

Implement automatic retry with different structures:

```python
async def attempt_booking(booking_data):
    structures = [
        lambda: add_empty_tickets(booking_data),
        lambda: add_tickets_with_unit_id(booking_data),
        lambda: remove_tickets_field(booking_data),
        lambda: add_tickets_as_separate_field(booking_data)
    ]
    
    for structure_fn in structures:
        try:
            modified_data = structure_fn()
            response = await book_tour(modified_data)
            if response.success:
                return response
        except BookingError as e:
            if "tickets" not in str(e):
                raise  # Different error, don't retry
            continue
    
    raise BookingError("All ticket structures failed")
```

### Phase 3: Create Dedicated Booking Tool

Create a new MCP tool specifically for OCTO bookings:

```yaml
name: octo_smart_booking
description: Intelligently handles OCTO bookings with automatic error recovery
parameters:
  - productId: string
  - optionId: string
  - date: string
  - unitId: string
  - quantity: integer
  - customerName: string
  - customerEmail: string
  - customerPhone: string
```

This tool would:
1. Validate all inputs
2. Check availability first
3. Try multiple booking structures
4. Return clear success/failure messages

## Immediate Actions

1. **Update Agent Instructions** with multiple booking structures to try
2. **Add Error Pattern Recognition** to help agent understand failures
3. **Create Debug Mode** that logs exact request/response for troubleshooting
4. **Document Supplier Variations** as we discover them

## Long-term Improvements

1. **Supplier Profile System**: Store known requirements per supplier
2. **Learning System**: Agent remembers successful patterns
3. **Fallback Options**: If automated booking fails, provide manual booking link
4. **Testing Suite**: Automated tests for different supplier configurations

## Example Enhanced Agent Instruction

```python
OCTO_BOOKING_INSTRUCTIONS = """
When creating OCTO bookings, follow this adaptive approach:

1. ALWAYS include header: Octo-Capabilities: octo/content

2. For booking requests, try these structures IN ORDER:

   ATTEMPT 1 - Standard structure:
   {
     "units": [{
       "id": "exact_unit_id",
       "quantity": 2,
       "tickets": [{}, {}]  // Empty objects
     }]
   }

   ATTEMPT 2 - If you get "tickets required" error:
   {
     "units": [{
       "id": "exact_unit_id",
       "quantity": 2,
       "tickets": [
         {"unitId": "exact_unit_id"},
         {"unitId": "exact_unit_id"}
       ]
     }]
   }

   ATTEMPT 3 - If still failing:
   {
     "units": [{
       "id": "exact_unit_id",
       "quantity": 2
     }],
     "tickets": [  // Tickets as separate field
       {"unitId": "exact_unit_id"},
       {"unitId": "exact_unit_id"}
     ]
   }

3. ALWAYS log the exact error message and request structure for debugging

4. If all attempts fail, inform user and suggest:
   - Trying a different date
   - Contacting support
   - Using the supplier's website directly
"""
```

## Success Metrics

1. Booking success rate > 90%
2. Average attempts per booking < 2
3. Clear error messages to users
4. Documented patterns for each supplier

## Next Steps

1. Implement Phase 1 immediately (enhanced instructions)
2. Test with real bookings to identify patterns
3. Build Phase 2 retry logic based on findings
4. Consider Phase 3 dedicated tool if complexity remains high