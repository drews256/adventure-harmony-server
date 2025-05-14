/**
 * Executes a function with exponential backoff retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffFactor?: number;
    retryableErrors?: (string | RegExp)[];
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    retryableErrors = []
  } = options;
  
  let currentDelay = initialDelay;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Last attempt failed, throw the error
      if (attempt > maxRetries) {
        throw error;
      }
      
      // Check if error is retryable
      const errorString = error.toString();
      const isRetryable = retryableErrors.length === 0 || 
        retryableErrors.some(pattern => {
          if (typeof pattern === 'string') {
            return errorString.includes(pattern);
          }
          return pattern.test(errorString);
        });
      
      if (!isRetryable) {
        throw error;
      }
      
      // Wait before retrying
      console.log(`Retry ${attempt}/${maxRetries} after ${currentDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      
      // Increase delay with backoff factor, but cap at maxDelay
      currentDelay = Math.min(currentDelay * backoffFactor, maxDelay);
    }
  }
  
  // This should never happen, but TypeScript needs a return value
  throw new Error('Retry logic failed');
}