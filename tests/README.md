# Test Suite Documentation

This directory contains comprehensive tests for the Message Analysis Server form system.

## Test Structure

```
tests/
├── README.md                          # This file
├── setup.ts                          # Test environment setup
├── helpers/
│   ├── database.ts                   # Database test utilities
│   └── mocks.ts                      # Mock implementations
├── services/                         # Unit tests
│   ├── form-generator.test.ts        # FormGenerator tool tests
│   └── sms-tool.test.ts             # SMS tool tests
├── integration/                      # Integration tests
│   ├── form-endpoints.test.ts        # API endpoint tests
│   └── form-processing.test.ts       # Background processing tests
└── e2e/                             # End-to-end tests
    └── complete-form-workflow.test.ts # Full workflow tests
```

## Test Categories

### Unit Tests (`tests/services/`)
- **form-generator.test.ts**: Tests the FormGenerator tool in isolation
  - JSON schema generation
  - UI schema generation  
  - Form creation and database storage
  - HTML generation
  - Tool definition validation

- **sms-tool.test.ts**: Tests the SMS tool functionality
  - Phone number validation
  - SMS message formatting
  - Development mode logging
  - Tool definition validation

### Integration Tests (`tests/integration/`)
- **form-endpoints.test.ts**: Tests HTTP endpoints
  - Form serving (GET /form/:formId)
  - Form submission (POST /api/form-submit)
  - Error handling and validation
  - Status code verification

- **form-processing.test.ts**: Tests background form processing
  - Form response processing logic
  - Conversation message creation
  - Context preservation
  - Error handling

### End-to-End Tests (`tests/e2e/`)
- **complete-form-workflow.test.ts**: Tests the complete form lifecycle
  - Form creation by business owner
  - SMS link distribution to customer
  - Form accessibility and validation
  - Customer form submission
  - Background processing
  - Conversation continuation

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode (for development)
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

### Specific Test Categories
```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# End-to-end tests only
npm run test:e2e
```

### Individual Test Files
```bash
# Specific test file
npx jest tests/services/form-generator.test.ts

# Specific test pattern
npx jest --testNamePattern="should create form"
```

## Test Environment

### Configuration
- Tests use `.env.test` for environment variables
- Test database uses same Supabase instance (with test prefixes)
- Console output is suppressed unless `TEST_VERBOSE=true`
- SMS sending is mocked in test environment

### Test Data Management
- All test data uses `test_` prefixes for easy cleanup
- `cleanupTestData()` helper removes test data after each test
- Database helpers create consistent test data structures

## Mock Strategy

### External Services
- **Anthropic API**: Mocked to return predictable responses
- **MCP Client**: Mocked tool execution and responses
- **Supabase Functions**: Mocked SMS sending functionality
- **Console Methods**: Spied on to verify logging behavior

### Real Database
- Tests use real Supabase database for integration testing
- Test data is isolated with prefixes and cleaned up automatically
- This ensures database schema and queries work correctly

## Test Scenarios Covered

### Happy Path
1. Business owner creates form via FormGenerator
2. SMS tool sends form link to customer
3. Customer accesses and submits form
4. Background agent processes submission
5. Conversation message created with form data
6. Context preserved throughout workflow

### Error Scenarios
- Invalid form configurations
- Invalid phone numbers for SMS
- Non-existent forms
- Expired forms
- Inactive forms
- Database errors
- Processing failures

### Edge Cases
- Forms with minimal data
- Complex form validation
- Form expiration handling
- Already processed responses
- Context preservation across threads

## Test Data Examples

### Sample Form Creation
```typescript
const form = await createTestForm({
  form_type: 'booking',
  form_title: 'Adventure Booking',
  customer_phone: '+1234567890',
  status: 'active'
});
```

### Sample Form Response
```typescript
const response = await createTestFormResponse(formId, {
  response_data: {
    name: 'John Doe',
    email: 'john@example.com',
    date: '2024-06-01'
  }
});
```

## Debugging Tests

### Verbose Output
```bash
TEST_VERBOSE=true npm test
```

### Debug Specific Test
```bash
npx jest --runInBand --verbose tests/e2e/complete-form-workflow.test.ts
```

### Coverage Analysis
```bash
npm run test:coverage
# Opens coverage report in coverage/lcov-report/index.html
```

## CI/CD Integration

Tests are designed to run in CI environments:
- No external dependencies (except configured Supabase)
- Deterministic test data and cleanup
- Clear pass/fail criteria
- Comprehensive error reporting

## Adding New Tests

### Unit Test Template
```typescript
import { YourService } from '../../src/services/your-service';
import { testSupabase, cleanupTestData } from '../helpers/database';

describe('YourService', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  it('should do something', async () => {
    // Test implementation
  });
});
```

### Integration Test Template
```typescript
import { testSupabase, createTestForm } from '../helpers/database';

describe('Your Integration', () => {
  it('should integrate properly', async () => {
    const testData = await createTestForm();
    // Test integration
  });
});
```

## Performance Considerations

- Tests run in parallel by default (Jest)
- Database cleanup is optimized with batch operations
- Mocking reduces external API calls
- Test timeout set to 30 seconds for complex operations

This test suite provides comprehensive coverage of the form system, ensuring reliability and maintainability of the codebase.