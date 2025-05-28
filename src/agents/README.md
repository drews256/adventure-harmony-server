# Morning Update System

This directory contains the morning update functionality for the message analysis server.

## Overview

The morning update system is integrated into the main Python worker (`python_worker_a2a.py`) and provides automated business updates to users based on their profile settings.

## Architecture

The morning update functionality is now integrated directly into the main worker process:

```
┌─────────────────────────┐
│   Python Worker (A2A)   │
│                         │
│  ┌───────────────────┐  │
│  │ Message Processor │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │     ┌─────────────────┐
│  │ Morning Update    │──┼────▶│   MCP Tools     │
│  │    Manager        │  │     │  (OCTO/GoGuide) │
│  └───────────────────┘  │     └─────────────────┘
└─────────────────────────┘              │
         │                               ▼
         │                     ┌─────────────────┐
         └────────────────────▶│   SMS Delivery  │
                               │  (via Supabase) │
                               └─────────────────┘
```

## Components

### 1. Morning Update Module (`morning_update.py`)
Contains:
- `ProfileSettings`: Data class for user preferences
- `MorningUpdateManager`: Main class that handles:
  - Fetching profile settings from database
  - Checking if updates should be sent
  - Gathering business metrics via MCP tools
  - Formatting update messages
  - Sending updates via SMS

### 2. Database Schema
The `profiles` table stores user settings:
```sql
profiles:
  - profile_id (UUID)
  - phone_number (TEXT, unique)
  - morning_update_settings (JSONB)
    - enabled (boolean)
    - time (string, e.g., "08:00")
    - timezone (string, e.g., "America/Denver")
```

## How It Works

1. The Python worker checks every minute for profiles that need morning updates
2. For each eligible profile, it:
   - Gathers business metrics from OCTO/GoGuide via MCP tools
   - Formats a concise SMS message with key metrics
   - Stores the message in the database
   - Triggers SMS delivery

## Message Format

Morning updates include:
- Yesterday's bookings and revenue
- Top performing products
- Upcoming week outlook
- Motivational closing message

Example:
```
☀️ Good morning! Your business update for 05/28:

📊 Yesterday: 5 bookings, $450.00
🏆 Top: Kayak Tour, Mountain Hike

📅 Next 7 days: 12 bookings, $1,200.00

🚀 Great momentum! Keep it up!
```

## Testing

To test the morning update for a specific phone number:

1. Ensure the profile exists in the database
2. The system will automatically check and send updates based on the profile's schedule

## Configuration

Profile settings can be updated in the database:
```sql
UPDATE profiles 
SET morning_update_settings = jsonb_set(
  morning_update_settings, 
  '{time}', 
  '"09:00"'
)
WHERE phone_number = '9709465380';
```

## Future Enhancements

- Web UI for managing profile settings
- Multiple update types (evening summary, weekly report)
- Customizable message templates
- More metrics and insights
- Multi-channel delivery (email, Slack)