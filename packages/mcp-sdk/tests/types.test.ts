/**
 * Tests for MCP SDK Types
 */

import {
  MCPErrorCodes,
  createSuccessResponse,
  createErrorResponse,
  createToolResponse,
  isErrorResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
} from '../src/types';

describe('MCPErrorCodes', () => {
  it('should have correct error codes', () => {
    expect(MCPErrorCodes.PARSE_ERROR).toBe(-32700);
    expect(MCPErrorCodes.INVALID_REQUEST).toBe(-32600);
    expect(MCPErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
    expect(MCPErrorCodes.INVALID_PARAMS).toBe(-32602);
    expect(MCPErrorCodes.INTERNAL_ERROR).toBe(-32603);
    expect(MCPErrorCodes.UNAUTHORIZED).toBe(-32001);
    expect(MCPErrorCodes.RATE_LIMITED).toBe(-32002);
    expect(MCPErrorCodes.RESOURCE_NOT_FOUND).toBe(-32003);
  });
});

describe('createSuccessResponse', () => {
  it('should create a valid success response', () => {
    const response = createSuccessResponse(1, { data: 'test' });

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.result).toEqual({ data: 'test' });
  });

  it('should work with string ids', () => {
    const response = createSuccessResponse('abc-123', { status: 'ok' });

    expect(response.id).toBe('abc-123');
  });

  it('should handle null result', () => {
    const response = createSuccessResponse(1, null);

    expect(response.result).toBeNull();
  });
});

describe('createErrorResponse', () => {
  it('should create a valid error response', () => {
    const response = createErrorResponse(1, MCPErrorCodes.INTERNAL_ERROR, 'Something went wrong');

    expect(response.jsonrpc).toBe('2.0');
    expect(response.id).toBe(1);
    expect(response.error.code).toBe(-32603);
    expect(response.error.message).toBe('Something went wrong');
  });

  it('should include optional data', () => {
    const response = createErrorResponse(1, MCPErrorCodes.INVALID_PARAMS, 'Bad params', {
      details: 'Missing required field',
    });

    expect(response.error.data).toEqual({ details: 'Missing required field' });
  });

  it('should handle null id', () => {
    const response = createErrorResponse(null, MCPErrorCodes.PARSE_ERROR, 'Parse error');

    expect(response.id).toBeNull();
  });
});

describe('createToolResponse', () => {
  it('should create a tool response with text content', () => {
    const response = createToolResponse({ status: 'success' });

    expect(response.isError).toBe(false);
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
    expect(response.content[0]).toHaveProperty('text');
    expect(JSON.parse((response.content[0] as any).text)).toEqual({ status: 'success' });
  });

  it('should create an error tool response', () => {
    const response = createToolResponse({ error: 'Something failed' }, true);

    expect(response.isError).toBe(true);
    expect(response.content).toHaveLength(1);
  });

  it('should serialize complex objects', () => {
    const data = {
      errors: [{ id: 1, message: 'Error 1' }],
      meta: { total: 1 },
    };
    const response = createToolResponse(data);

    expect(JSON.parse((response.content[0] as any).text)).toEqual(data);
  });
});

describe('isErrorResponse', () => {
  it('should return true for error responses', () => {
    const errorResponse: JsonRpcErrorResponse = {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32600, message: 'Invalid request' },
    };

    expect(isErrorResponse(errorResponse)).toBe(true);
  });

  it('should return false for success responses', () => {
    const successResponse: JsonRpcSuccessResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { data: 'test' },
    };

    expect(isErrorResponse(successResponse)).toBe(false);
  });
});
