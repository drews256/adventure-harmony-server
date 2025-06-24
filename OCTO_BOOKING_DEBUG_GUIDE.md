# OCTO Booking Debug Guide

## Common Booking Errors and Solutions

### Error: "Validation failed: unitItems array is required with at least one unitId"

This error means you need to use the correct Ventrata API structure. Use `unitItems` instead of `units`:

#### Correct Structure: unitItems Array
```json
{
  "productId": "20ef1799-7020-484b-9fb5-905ec5bb5444",
  "optionId": "DEFAULT",
  "availabilityId": "2025-07-01",
  "unitItems": [
    {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"},
    {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"}
  ]
}
```

#### With UUID for Idempotency (Recommended)
```json
{
  "productId": "20ef1799-7020-484b-9fb5-905ec5bb5444",
  "optionId": "DEFAULT",
  "availabilityId": "2025-07-01",
  "unitItems": [
    {
      "unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
      "uuid": "550e8400-e29b-41d4-a716-446655440000"
    },
    {
      "unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
      "uuid": "550e8400-e29b-41d4-a716-446655440001"
    }
  ]
}
```

### Important: Do NOT Use These Incorrect Formats

❌ **WRONG - Using units array:**
```json
{
  "units": [{"id": "...", "quantity": 2}]
}
```

❌ **WRONG - Including contact info:**
```json
{
  "contact": {"fullName": "...", "email": "..."}
}
```

### Error: "Field availabilityId is required"

- Make sure you're using the `id` field from availability response
- The availabilityId is typically the date in YYYY-MM-DD format
- Example: If availability response has `"id": "2024-06-15"`, use `"availabilityId": "2024-06-15"`

### Error: "Invalid unit ID"

- Unit IDs must be exact UUIDs from the products response
- Path: GET /products → response[].options[].units[].id
- Never use generic names like "adult" or "child"

### Error: "Missing Octo-Capabilities header"

Add to all requests:
```
Octo-Capabilities: octo/content
```

## Debug Checklist

1. **Verify Product Data**
   ```
   productId: Is it the exact ID from products response?
   optionId: Is it from product.options[].id?
   unitId: Is it from product.options[].units[].id?
   ```

2. **Verify Availability Data**
   ```
   availabilityId: Is it the 'id' field from availability response?
   localDate: Does it match the availabilityId date?
   ```

3. **Check Headers**
   ```
   Authorization: Bearer [token]
   Content-Type: application/json
   Octo-Capabilities: octo/content
   ```

4. **Validate Structure**
   - Is unitItems an array?
   - Does each unitItem have a unitId?
   - Are all required fields present (productId, optionId, availabilityId, unitItems)?

## Testing Different Suppliers

Different OCTO suppliers may have different requirements:

### Ventrata API (OCTO Implementation)
- Requires unitItems array (not units)
- Each unitItem needs only unitId
- No contact information required
- Optional UUID for idempotency

### Other OCTO Implementations
Different OCTO API implementations may have different requirements. Always check the specific API documentation for the supplier you're integrating with.

## Logging for Debug

When a booking fails, log:
1. Exact request sent (with sensitive data redacted)
2. Exact error response
3. Which structure was attempted
4. Supplier/product information

Example log format:
```
BOOKING ATTEMPT FAILED
Supplier: Ventrata
Product: 20ef1799-7020-484b-9fb5-905ec5bb5444
Structure: unitItems array
Error: "Validation failed: unitItems array is required"
Fix: Use unitItems instead of units
```

## Quick Reference

### Working Booking Request (Ventrata OCTO API)
```json
{
  "productId": "20ef1799-7020-484b-9fb5-905ec5bb5444",
  "optionId": "DEFAULT",
  "availabilityId": "2025-07-01",
  "unitItems": [
    {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"},
    {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"}
  ],
  "notes": "Optional booking notes"
}
```

### Required Headers
```
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json
Octo-Capabilities: octo/content
```

## When All Else Fails

If automated booking continues to fail:
1. Log the exact error and request for manual review
2. Provide user with supplier contact information
3. Suggest booking directly through supplier website
4. Create a support ticket for engineering team

Remember: The goal is to help users book tours, whether through automation or by guiding them to alternatives.