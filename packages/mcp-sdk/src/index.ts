/**
 * @savvagent/mcp-sdk
 * Model Context Protocol SDK for Savvagent integrations
 *
 * This SDK provides the foundation for building MCP servers that integrate
 * with Savvagent's AI-powered feature flag platform using StreamableHTTP transport
 * and JSON-RPC 2.0 protocol.
 *
 * Key features:
 * - StreamableHTTP transport (single POST /mcp endpoint)
 * - Bearer token authentication
 * - JSON-RPC 2.0 protocol support
 * - Tool registration and execution
 */

// Export all types
export * from './types';

// Export server class and helpers
export {
  MCPServer,
  createHttpHandler,
  createStdioHandler,
  createAuthMiddleware,
} from './server';

// Export server-related types
export type { AuthConfig, HttpHandlerOptions, HttpRequest, HttpResponse } from './server';

// Re-export commonly used types for convenience
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  MCPTool,
  MCPServerConfig,
  MCPHealthStatus,
  ToolHandler,
  ToolDefinition,
  ToolInputSchema,
  ToolCallResult,
  ToolContent,
  TextContent,
  ImageContent,
  ResourceContent,
} from './types';

// Re-export helper functions
export {
  MCPErrorCodes,
  createSuccessResponse,
  createErrorResponse,
  createToolResponse,
  isErrorResponse,
} from './types';
