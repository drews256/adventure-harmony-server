# OCTO Booking API - Key Clarifications

Based on the tests in openapi-mcp-server and the enhanced OCTO-API.yaml specification, here are the critical clarifications for the OCTO booking flow:

## 1. Required Header for ALL Requests
```
Octo-Capabilities: octo/content
```
This header MUST be included in every OCTO API request.

## 2. The availabilityId Mystery - SOLVED!
The biggest confusion has been about what to use as `availabilityId` in the booking request.

**THE ANSWER**: The `id` field from the availability response IS your availabilityId!

Example availability response:
```json
{
  "id": "2024-06-15",  // <-- THIS is your availabilityId!
  "localDateTimeStart": "2024-06-15T00:00:00+01:00",
  "localDateTimeEnd": "2024-06-15T23:59:00+01:00",
  "available": true,
  "status": "AVAILABLE"
}
```

When booking, use:
```json
{
  "availabilityId": "2024-06-15",  // The 'id' from above!
  "localDate": "2024-06-15",
  // ... rest of booking
}
```

## 3. Tickets Structure - Nested in Units
Tickets are NOT a separate field. They're nested inside each unit object:

```json
{
  "units": [
    {
      "id": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af",
      "quantity": 2,
      "tickets": [{}, {}]  // Array of empty objects matching quantity
    }
  ]
}
```

## 4. Complete Working Flow

### Step 1: GET /products
Save these exact values:
- productId: `"20ef1799-7020-484b-9fb5-905ec5bb5444"`
- optionId: `"DEFAULT"` (from product.options[].id)
- unitId: `"unit_3e987c7b-b87e-47bf-8638-148cdaf700af"` (from product.options[].units[].id)

### Step 2: POST /availability
```json
{
  "productId": "20ef1799-7020-484b-9fb5-905ec5bb5444",
  "optionId": "DEFAULT",
  "localDateStart": "2024-06-15",
  "localDateEnd": "2024-06-15",
  "units": [{"id": "unit_3e987c7b-b87e-47bf-8638-148cdaf700af", "quantity": 2}]
}
```

Response includes:
```json
{
  "id": "2024-06-15",  // SAVE THIS AS availabilityId!
  "available": true
}
```

### Step 3: POST /bookings
```json
{
  "productId": "20ef1799-7020-484b-9fb5-905ec5bb5444",
  "optionId": "DEFAULT",
  "localDate": "2024-06-15",
  "availabilityId": "2024-06-15",  // The 'id' from step 2!
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

## Common Errors Fixed

1. **"Field units must be an array"** - Always use array format for units
2. **"Invalid availability ID"** - Use the 'id' field from availability response
3. **"Tickets required"** - Add tickets array inside each unit object
4. **"Missing capabilities header"** - Add `Octo-Capabilities: octo/content`

## Key Takeaways

1. Unit IDs are UUIDs, never generic names like "adult"
2. The availabilityId is just the date from the availability response
3. Tickets are nested inside units, not a separate field
4. Every request needs the Octo-Capabilities header
5. Some suppliers may not require tickets - adapt based on error messages