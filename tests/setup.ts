import dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise in tests (optional)
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Override console methods during tests
console.log = (...args: any[]) => {
  // Only log if TEST_VERBOSE is set
  if (process.env.TEST_VERBOSE) {
    originalConsoleLog(...args);
  }
};

console.error = (...args: any[]) => {
  // Always log errors
  originalConsoleError(...args);
};

// Global test timeout
jest.setTimeout(30000);

// Clean up after all tests
afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});