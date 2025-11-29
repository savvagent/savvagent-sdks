/**
 * Savvagent MCP SDK Types
 * Core type definitions for MCP (Model Context Protocol) JSON-RPC 2.0 integrations
 */

// =============================================================================
// JSON-RPC 2.0 Core Types
// =============================================================================

/**
 * JSON-RPC 2.0 request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: number | string;
}

/**
 * JSON-RPC 2.0 success response
 */
export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number | string;
  result: any;
}

/**
 * JSON-RPC 2.0 error response
 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  error: JsonRpcError;
}

/**
 * JSON-RPC 2.0 error object
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

/**
 * JSON-RPC 2.0 response (union type)
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// =============================================================================
// MCP Error Codes
// =============================================================================

/**
 * Standard JSON-RPC 2.0 and MCP error codes
 */
export const MCPErrorCodes = {
  /** Invalid JSON */
  PARSE_ERROR: -32700,
  /** Missing required fields */
  INVALID_REQUEST: -32600,
  /** Unknown method name */
  METHOD_NOT_FOUND: -32601,
  /** Parameter validation failed */
  INVALID_PARAMS: -32602,
  /** Server-side error */
  INTERNAL_ERROR: -32603,
  /** Invalid or missing credentials */
  UNAUTHORIZED: -32001,
  /** Too many requests */
  RATE_LIMITED: -32002,
  /** Requested data doesn't exist */
  RESOURCE_NOT_FOUND: -32003,
} as const;

export type MCPErrorCode = (typeof MCPErrorCodes)[keyof typeof MCPErrorCodes];

// =============================================================================
// MCP Protocol Types
// =============================================================================

/**
 * Tool input schema (JSON Schema draft-07)
 */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema property definition
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number | boolean)[];
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: JsonSchemaProperty;
  examples?: any[];
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

/**
 * Content types for tool responses
 */
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

export type ToolContent = TextContent | ImageContent | ResourceContent;

/**
 * Tool call result
 */
export interface ToolCallResult {
  content: ToolContent[];
  isError: boolean;
}

// =============================================================================
// MCP Method Parameters and Results
// =============================================================================

/**
 * initialize method parameters
 */
export interface InitializeParams {
  protocolVersion: string;
  capabilities: Record<string, any>;
  clientInfo: {
    name: string;
    version: string;
  };
}

/**
 * initialize method result
 */
export interface InitializeResult {
  protocolVersion: string;
  serverInfo: {
    name: string;
    version: string;
  };
  capabilities: {
    tools?: Record<string, any>;
    resources?: Record<string, any>;
    prompts?: Record<string, any>;
  };
}

/**
 * tools/list result
 */
export interface ToolsListResult {
  tools: MCPTool[];
}

/**
 * tools/call parameters
 */
export interface ToolsCallParams {
  name: string;
  arguments?: Record<string, any>;
}

// =============================================================================
// Server Configuration Types
// =============================================================================

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Additional configuration options */
  options?: Record<string, any>;
}

/**
 * MCP server health status
 */
export interface MCPHealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  details?: Record<string, any>;
}

// =============================================================================
// Tool Handler Types
// =============================================================================

/**
 * Tool handler function signature
 */
export type ToolHandler = (args: Record<string, any>) => Promise<any>;

/**
 * Tool definition with handler
 */
export interface ToolDefinition {
  tool: MCPTool;
  handler: ToolHandler;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a JSON-RPC success response
 */
export function createSuccessResponse(id: number | string, result: any): JsonRpcSuccessResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: any
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

/**
 * Create a tool response with text content
 */
export function createToolResponse(data: any, isError = false): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError,
  };
}

/**
 * Check if a response is an error response
 */
export function isErrorResponse(response: JsonRpcResponse): response is JsonRpcErrorResponse {
  return 'error' in response;
}
