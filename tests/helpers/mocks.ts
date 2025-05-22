/**
 * Mock the Anthropic SDK for testing
 */
export function mockAnthropicAPI() {
  const mockCreate = jest.fn().mockResolvedValue({
    content: [
      {
        type: 'text',
        text: 'Mocked response from Claude'
      }
    ]
  });

  return {
    messages: {
      create: mockCreate
    },
    mockCreate
  };
}

/**
 * Mock the MCP client for testing
 */
export function mockMCPClient() {
  const mockCallTool = jest.fn().mockResolvedValue({
    status: 'success',
    result: 'Mocked tool result'
  });

  const mockGetTools = jest.fn().mockResolvedValue([
    {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string' }
        }
      }
    }
  ]);

  return {
    callTool: mockCallTool,
    getTools: mockGetTools,
    mockCallTool,
    mockGetTools
  };
}

/**
 * Mock Supabase functions for testing
 */
export function mockSupabaseFunctions() {
  const mockInvoke = jest.fn().mockResolvedValue({
    data: { success: true },
    error: null
  });

  return {
    functions: {
      invoke: mockInvoke
    },
    mockInvoke
  };
}

/**
 * Mock console methods with Jest spies
 */
export function mockConsole() {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn
  };

  const consoleSpy = {
    log: jest.spyOn(console, 'log').mockImplementation(() => {}),
    error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    warn: jest.spyOn(console, 'warn').mockImplementation(() => {})
  };

  const restore = () => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
    consoleSpy.warn.mockRestore();
  };

  return { consoleSpy, restore };
}

/**
 * Create a mock Express request object
 */
export function mockRequest(overrides: any = {}) {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides
  };
}

/**
 * Create a mock Express response object
 */
export function mockResponse() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}