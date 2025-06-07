# OCTO Booking Debug Guide

## Common Booking Errors and Solutions

### Error: "Validation failed: Bookings[0] tickets at least one ticket is required"

This error means the supplier requires tickets but the structure isn't correct. Try these structures in order:

#### Structure 1: Empty Tickets
```json
{
  "units": [{
    "id": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
    "quantity": 2,
    "tickets": [{}, {}]
  }]
}
```

#### Structure 2: Tickets with unitId
```json
{
  "units": [{
    "id": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
    "quantity": 2,
    "tickets": [
      {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"},
      {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"}
    ]
  }]
}
```

#### Structure 3: Tickets as Separate Field
```json
{
  "units": [{
    "id": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
    "quantity": 2
  }],
  "tickets": [
    {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"},
    {"unitId": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af"}
  ]
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
   - Is units an array?
   - Does tickets count match quantity?
   - Are all required fields present?

## Testing Different Suppliers

Different OCTO suppliers may have different requirements:

### Type A Suppliers (Standard)
- Require tickets array inside units
- Accept empty ticket objects

### Type B Suppliers (Detailed)
- Require tickets with unitId reference
- May require additional ticket fields

### Type C Suppliers (Simple)
- Don't require tickets at all
- Just units with quantity

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
Structure: Type 1 (empty tickets)
Error: "Validation failed: Bookings[0] tickets at least one ticket is required"
Next Action: Trying Structure Type 2
```

## Quick Reference

### Working Booking Request (most common)
```json
{
  "productId": "20ef1799-7020-484b-9fb5-905ec5bb5444",
  "optionId": "DEFAULT",
  "localDate": "2024-06-15",
  "availabilityId": "2024-06-15",
  "contact": {
    "fullName": "John Doe",
    "emailAddress": "john@example.com",
    "phoneNumber": "+12125551234"
  },
  "units": [{
    "id": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
    "quantity": 2,
    "tickets": [{}, {}]
  }]
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