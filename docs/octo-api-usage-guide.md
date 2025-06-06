# OCTO API Usage Guide for SMS Agent

This guide helps the agent correctly use the OCTO API endpoints for booking tours and activities.

## Important: API Flow

The OCTO API requires a specific flow:
1. **Search products** → Get product IDs
2. **Check availability** → Get availability IDs and time slots  
3. **Create booking** → Use the availability ID from step 2

## Common Errors and Solutions

### Error: "Field units must be an array"

**Problem**: The `units` parameter must always be an array, even for a single person.

**Wrong**:
```json
{
  "units": {
    "id": "adult_unit_id",
    "quantity": 2
  }
}
```

**Correct**:
```json
{
  "units": [
    {
      "id": "adult_unit_id", 
      "quantity": 2
    }
  ]
}
```

### Error: "Invalid availability ID"

**Problem**: The `availabilityId` must come from the availability check response. You cannot make up IDs.

**Wrong**:
```json
{
  "availabilityId": "pub_crawl_20250608"  // Made up ID
}
```

**Correct Flow**:
1. First check availability:
   ```json
   POST /availability
   {
     "productId": "pub_crawl_product",
     "localDateStart": "2025-06-08",
     "localDateEnd": "2025-06-08",
     "units": [{"id": "adult_unit", "quantity": 2}]
   }
   ```

2. Get response with availability ID:
   ```json
   {
     "availabilityId": "av_12345_20250608_1900",
     "localDate": "2025-06-08",
     "localTime": "19:00",
     "status": "AVAILABLE"
   }
   ```

3. Use that ID for booking:
   ```json
   POST /bookings
   {
     "availabilityId": "av_12345_20250608_1900",  // From availability response
     "productId": "pub_crawl_product",
     "optionId": "standard_option",
     "localDate": "2025-06-08",
     "units": [{"id": "adult_unit", "quantity": 2}],
     "contact": {
       "fullName": "John Smith",
       "emailAddress": "john@example.com"
     }
   }
   ```

## Example Booking Flow

### Step 1: User asks about tours
**User**: "What pub crawl tours do you have?"

**Agent calls**: GET /products

**Response includes**:
```json
[
  {
    "id": "pub_crawl_001",
    "internalName": "Historic Pub Crawl",
    "options": [
      {
        "id": "standard_tour",
        "units": [
          {
            "id": "unit_adult",
            "internalName": "Adult",
            "pricing": [{"price": 4500, "currency": "USD"}]
          }
        ]
      }
    ]
  }
]
```

### Step 2: User wants to check availability
**User**: "Is it available this Saturday for 2 people?"

**Agent calls**: POST /availability
```json
{
  "productId": "pub_crawl_001",
  "optionId": "standard_tour",
  "localDateStart": "2025-06-08",
  "localDateEnd": "2025-06-08",
  "units": [
    {
      "id": "unit_adult",
      "quantity": 2
    }
  ]
}
```

**Response**:
```json
[
  {
    "localDate": "2025-06-08",
    "available": true,
    "availabilityId": "av_pub_crawl_001_20250608_1900",
    "startTime": "19:00",
    "status": "AVAILABLE"
  }
]
```

### Step 3: User wants to book
**User**: "Book the 7pm tour"

**Agent calls**: POST /bookings
```json
{
  "productId": "pub_crawl_001",
  "optionId": "standard_tour", 
  "availabilityId": "av_pub_crawl_001_20250608_1900",
  "localDate": "2025-06-08",
  "localTime": "19:00",
  "units": [
    {
      "id": "unit_adult",
      "quantity": 2
    }
  ],
  "contact": {
    "fullName": "John Smith",
    "emailAddress": "john@example.com",
    "phoneNumber": "+1234567890"
  }
}
```

## Key Rules

1. **Always use arrays for units** - Even for 1 person
2. **Get availability ID from availability check** - Never make up IDs
3. **Include all required fields** - Check the API spec
4. **Use correct unit IDs** - Get these from the products endpoint
5. **Follow the flow** - Products → Availability → Booking