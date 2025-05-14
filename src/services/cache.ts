/**
 * Simple in-memory cache implementation
 */
class SimpleCache {
  private cache: Map<string, { value: any, expiry: number }> = new Map();
  private readonly defaultTtl: number; // in seconds
  
  constructor(defaultTtl = 900) { // Default 15 minutes
    this.defaultTtl = defaultTtl;
    
    // Set up periodic cleanup of expired items
    setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }
  
  /**
   * Get a value from cache
   */
  get(key: string): any {
    const item = this.cache.get(key);
    
    if (!item) {
      return undefined;
    }
    
    // Check if the item has expired
    if (item.expiry < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    
    return item.value;
  }
  
  /**
   * Set a value in cache with optional TTL
   */
  set(key: string, value: any, ttl?: number): void {
    const expiry = Date.now() + (ttl ?? this.defaultTtl) * 1000;
    this.cache.set(key, { value, expiry });
  }
  
  /**
   * Delete a value from cache
   */
  del(key: string): void {
    this.cache.delete(key);
  }
  
  /**
   * Get all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * Clear all items from cache
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Remove expired items
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (item.expiry < now) {
        this.cache.delete(key);
      }
    }
  }
}

// Create a cache with 15-minute TTL
const apiCache = new SimpleCache(900);

/**
 * Cache key generator
 */
export function generateCacheKey(toolName: string, args: Record<string, unknown>): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

/**
 * Cache middleware for API calls
 */
export async function cachedToolCall(
  toolName: string, 
  args: Record<string, unknown>, 
  callFn: () => Promise<any>
): Promise<any> {
  const cacheKey = generateCacheKey(toolName, args);
  
  // Check if result is in cache
  const cachedResult = apiCache.get(cacheKey);
  if (cachedResult) {
    console.log(`Cache hit for ${toolName}`);
    return cachedResult;
  }
  
  // Execute the call
  const result = await callFn();
  
  // Cache the result
  apiCache.set(cacheKey, result);
  
  return result;
}

/**
 * Clear cache entries that match a pattern
 */
export function clearCacheByPattern(pattern: string): void {
  const keys = apiCache.keys();
  const matchingKeys = keys.filter(key => key.includes(pattern));
  matchingKeys.forEach(key => apiCache.del(key));
}