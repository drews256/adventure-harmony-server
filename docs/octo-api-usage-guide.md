# OCTO API Usage Guide for SMS Agent

This guide helps the agent correctly use the OCTO API endpoints for booking tours and activities.

## Important: API Flow

The OCTO API requires a specific flow:
1. **Search products** → Get product IDs, option IDs, and unit IDs
2. **Check availability** → Get availability IDs and time slots  
3. **Create booking** → Use the availability ID from step 2

## Where to Find Unit IDs

Units are NOT a separate API endpoint. They come from the `/products` response:

```
GET /products
└── Product
    ├── id: "tour_123"
    └── options: [
        {
            id: "morning_tour",
            units: [
                {
                    id: "unit_adult",        // <-- Use this ID
                    internalName: "Adult",
                    pricing: [...]
                },
                {
                    id: "unit_child",        // <-- Use this ID
                    internalName: "Child (5-12)",
                    pricing: [...]
                }
            ]
        }
    ]
```

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

**Critical Notes for Availability Check**:
- `productId`: Use exact value from GET /products response field `id`
- `optionId`: Use exact value from `product.options[].id`
- `units`: MUST be an array, even for 1 person
- Unit `id`: Use EXACT value from `product.options[].units[].id`
- Dates: Must be YYYY-MM-DD format
- The response will contain `availabilityId` - SAVE THIS FOR BOOKING!

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
      "quantity": 2,
      "tickets": [
        {},
        {}
      ]
    }
  ],
  "contact": {
    "fullName": "John Smith",
    "emailAddress": "john@example.com",
    "phoneNumber": "+1234567890"
  }
}
```

**Critical Note**: Each unit object MUST include a `tickets` array with the same number of ticket objects as the `quantity`. Even if the ticket objects are empty, they must be present.

## Key Rules

1. **Always use arrays for units** - Even for 1 person
2. **Get availability ID from availability check** - Never make up IDs
3. **Include all required fields** - Check the API spec
4. **Use correct unit IDs** - Get these from the products endpoint
5. **Follow the flow** - Products → Availability → Booking

## Availability Check Troubleshooting

### Common Availability Errors and Solutions

1. **"Field units must be an array"**
   - Wrong: `"units": {"id": "unit_adult", "quantity": 2}`
   - Right: `"units": [{"id": "unit_adult", "quantity": 2}]`

2. **"Invalid unit ID"**
   - Wrong: `"units": [{"id": "adult", "quantity": 2}]`
   - Right: `"units": [{"id": "unit_adult_6a7b8c9d", "quantity": 2}]`
   - Unit IDs come from: `GET /products` → `response[].options[].units[].id`

3. **"Missing required fields"**
   - Required: `productId`, `localDateStart`, `localDateEnd`
   - Optional but recommended: `optionId` (for specific tour variant)

4. **"Invalid date format"**
   - Wrong: `"localDateStart": "06/08/2025"` or `"localDateStart": "2025-6-8"`
   - Right: `"localDateStart": "2025-06-08"`

### How to Extract IDs from Products Response

Given this products response:
```json
{
  "id": "sunset_cruise",
  "options": [{
    "id": "premium_option",
    "units": [{
      "id": "unit_adult_abc123",
      "internalName": "Adult"
    }]
  }]
}
```

Your availability request should use:
- `productId`: "sunset_cruise"
- `optionId`: "premium_option"
- `units`: [{"id": "unit_adult_abc123", "quantity": 2}]