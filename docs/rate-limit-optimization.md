# Rate Limit Optimization Strategy for Anthropic Models

## Current Model Usage
- **Model**: Claude 3.5 Sonnet (`claude-3-5-sonnet-20241022`)
- **Issue**: Frequent rate limit errors

## Anthropic Model Options and Rate Limits

### Available Models (by capability and cost):
1. **Claude 3.5 Sonnet** (current)
   - Highest capability, but also highest rate limit pressure
   - Best for complex reasoning and tool use
   - Model ID: `claude-3-5-sonnet-20241022`

2. **Claude 3.5 Haiku** (recommended for SMS)
   - Much faster and cheaper
   - Lower rate limit pressure
   - Excellent for short conversations
   - Model ID: `claude-3-5-haiku-20241022`

3. **Claude 3 Haiku**
   - Even cheaper option
   - Good for simple queries
   - Model ID: `claude-3-haiku-20240307`

## Optimization Strategies

### 1. Switch to Claude 3.5 Haiku for SMS
```python
# Change in sms_agent_agno_mcp.py
model=Claude(id="claude-3-5-haiku-20241022"),  # Instead of sonnet
```
**Benefits**: 
- ~10x cheaper than Sonnet
- Much higher rate limits
- Still very capable for SMS conversations
- Faster response times

### 2. Implement Request Queuing
Add a delay between requests to avoid bursts:
```python
import asyncio

class AgnoMCPSMSAgent:
    def __init__(self, ...):
        self._last_request_time = 0
        self._min_request_interval = 1.0  # 1 second between requests
    
    async def process_message(self, ...):
        # Rate limit protection
        current_time = time.time()
        time_since_last = current_time - self._last_request_time
        if time_since_last < self._min_request_interval:
            await asyncio.sleep(self._min_request_interval - time_since_last)
        
        self._last_request_time = time.time()
        # Continue with normal processing
```

### 3. Optimize Token Usage

#### A. Reduce conversation history
```python
# Current: num_history_runs=5 (10 messages)
# Optimized: num_history_runs=3 (6 messages)
num_history_runs=3,  # Reduce context to save tokens
```

#### B. Compress system instructions
```python
instructions="""SMS assistant for Adventure Harmony.
Help with: bookings, weather, calendar, destinations.
Be concise and friendly. Keep responses brief for SMS."""
```

### 4. Implement Exponential Backoff for Rate Limits
```python
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=60)
)
async def _call_agent(self, message):
    return await self.agent.arun(message=message, stream=False)
```

### 5. Add Response Caching
Cache common queries to avoid repeated API calls:
```python
from functools import lru_cache
import hashlib

class AgnoMCPSMSAgent:
    def __init__(self, ...):
        self._response_cache = {}
        self._cache_ttl = 300  # 5 minutes
    
    def _get_cache_key(self, message, profile_id):
        return hashlib.md5(f"{message}:{profile_id}".encode()).hexdigest()
```

### 6. Monitor and Alert
Add logging for rate limit tracking:
```python
import logging

logger.info(f"API call for profile {profile_id} at {datetime.now()}")
# Track rate limit headers in responses if available
```

## Recommended Implementation Priority

1. **Immediate**: Switch to Claude 3.5 Haiku
2. **Next**: Add request queuing/delays
3. **Then**: Implement exponential backoff
4. **Optional**: Add caching for common queries

## Model Selection Guide

| Use Case | Recommended Model | Why |
|----------|------------------|-----|
| Simple SMS queries | Claude 3.5 Haiku | Fast, cheap, sufficient |
| Complex tool use | Claude 3.5 Sonnet | Better reasoning |
| High volume | Claude 3 Haiku | Lowest cost |
| Weather/Calendar | Claude 3.5 Haiku | Simple structured data |

## Cost Comparison (approximate)
- Claude 3.5 Sonnet: $3/$15 per million tokens (input/output)
- Claude 3.5 Haiku: $0.25/$1.25 per million tokens
- Claude 3 Haiku: $0.25/$1.25 per million tokens

## Implementation Example
```python
# For SMS agent, use Haiku by default with Sonnet fallback
try:
    model = Claude(id="claude-3-5-haiku-20241022")
except RateLimitError:
    # Fallback to even cheaper model
    model = Claude(id="claude-3-haiku-20240307")
```