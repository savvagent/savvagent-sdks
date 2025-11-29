/**
 * Savvagent MCP SDK - Server Class
 * Base class for implementing MCP servers with StreamableHTTP transport and JSON-RPC 2.0 protocol
 *
 * MCP servers use a single HTTP endpoint (typically POST /mcp) that handles all JSON-RPC requests.
 * Authentication is done via Bearer token in the Authorization header.
 */

import {
  JsonRpcRequest,
  JsonRpcResponse,
  MCPServerConfig,
  MCPHealthStatus,
  MCPTool,
  ToolDefinition,
  ToolHandler,
  ToolCallResult,
  InitializeParams,
  InitializeResult,
  ToolsListResult,
  ToolsCallParams,
  MCPErrorCodes,
  createSuccessResponse,
  createErrorResponse,
  createToolResponse,
} from './types';

/**
 * Authentication configuration for MCP servers
 */
export interface AuthConfig {
  /** Bearer token for authentication */
  token: string;
  /** Paths to skip authentication (e.g., ['/health']) */
  skipPaths?: string[];
}

/**
 * HTTP request interface for Express-compatible handlers
 */
export interface HttpRequest {
  body: any;
  path?: string;
  headers: {
    authorization?: string;
    [key: string]: string | undefined;
  };
}

/**
 * HTTP response interface for Express-compatible handlers
 */
export interface HttpResponse {
  json: (data: any) => void;
  status: (code: number) => HttpResponse;
}

/**
 * MCP Server base class
 * Extend this class to create custom MCP servers with tool implementations
 */
export class MCPServer {
  protected config: MCPServerConfig;
  protected tools: Map<string, ToolDefinition> = new Map();
  protected initialized: boolean = false;

  constructor(config: MCPServerConfig) {
    this.config = config;
  }

  /**
   * Register a tool with the server
   *
   * @param name - Tool name (snake_case recommended)
   * @param description - Tool description for the AI
   * @param inputSchema - JSON Schema for tool parameters
   * @param handler - Async function to handle tool calls
   */
  registerTool(
    name: string,
    description: string,
    inputSchema: MCPTool['inputSchema'],
    handler: ToolHandler
  ): void {
    this.tools.set(name, {
      tool: { name, description, inputSchema },
      handler,
    });
  }

  /**
   * Unregister a tool from the server
   *
   * @param name - Tool name to remove
   */
  unregisterTool(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get list of registered tools
   *
   * @returns Array of tool definitions
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values()).map((td) => td.tool);
  }

  /**
   * Handle incoming JSON-RPC request
   * Main entry point for processing MCP protocol messages
   *
   * @param request - JSON-RPC 2.0 request
   * @returns JSON-RPC 2.0 response
   */
  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params, id } = request;

    // Validate request format
    if (request.jsonrpc !== '2.0') {
      return createErrorResponse(id, MCPErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC version');
    }

    if (!method || id === undefined) {
      return createErrorResponse(
        id ?? null,
        MCPErrorCodes.INVALID_REQUEST,
        'Missing method or id'
      );
    }

    try {
      switch (method) {
        case 'initialize':
          return this.handleInitialize(id, params as InitializeParams);

        case 'tools/list':
          return this.handleToolsList(id);

        case 'tools/call':
          return this.handleToolsCall(id, params as ToolsCallParams);

        default:
          return createErrorResponse(id, MCPErrorCodes.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(id, MCPErrorCodes.INTERNAL_ERROR, message);
    }
  }

  /**
   * Handle initialize method
   */
  protected handleInitialize(
    id: number | string,
    params?: InitializeParams
  ): JsonRpcResponse {
    this.initialized = true;

    const result: InitializeResult = {
      protocolVersion: params?.protocolVersion || '2024-11-05',
      serverInfo: {
        name: this.config.name,
        version: this.config.version,
      },
      capabilities: {
        tools: {},
      },
    };

    return createSuccessResponse(id, result);
  }

  /**
   * Handle tools/list method
   */
  protected handleToolsList(id: number | string): JsonRpcResponse {
    const result: ToolsListResult = {
      tools: this.getTools(),
    };

    return createSuccessResponse(id, result);
  }

  /**
   * Handle tools/call method
   */
  protected async handleToolsCall(
    id: number | string,
    params?: ToolsCallParams
  ): Promise<JsonRpcResponse> {
    if (!params?.name) {
      return createErrorResponse(id, MCPErrorCodes.INVALID_PARAMS, 'Missing tool name');
    }

    const { name, arguments: args = {} } = params;
    const toolDef = this.tools.get(name);

    if (!toolDef) {
      return createErrorResponse(id, MCPErrorCodes.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
    }

    try {
      // Validate required parameters
      const required = toolDef.tool.inputSchema.required || [];
      for (const param of required) {
        if (args[param] === undefined) {
          return createSuccessResponse(id, createToolResponse(
            { error: `Missing required parameter: ${param}` },
            true
          ));
        }
      }

      // Call the tool handler
      const result = await toolDef.handler(args);

      return createSuccessResponse(id, createToolResponse(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      return createSuccessResponse(id, createToolResponse({ error: message }, true));
    }
  }

  /**
   * Health check endpoint
   *
   * @returns Health status
   */
  async healthCheck(): Promise<MCPHealthStatus> {
    return {
      status: 'ok',
      version: this.config.version,
      timestamp: new Date().toISOString(),
      details: {
        toolCount: this.tools.size,
        initialized: this.initialized,
      },
    };
  }

  /**
   * Initialize the server (override for custom initialization)
   */
  async initialize(): Promise<void> {
    this.initialized = true;
  }

  /**
   * Shutdown the server (override for cleanup)
   */
  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Check if server is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get server configuration
   */
  getConfig(): MCPServerConfig {
    return { ...this.config };
  }
}

/**
 * Options for creating an HTTP handler
 */
export interface HttpHandlerOptions {
  /** Authentication configuration (optional) */
  auth?: AuthConfig;
}

/**
 * Express/HTTP request handler helper for StreamableHTTP transport
 * Creates an Express-compatible handler for MCP servers with optional Bearer token authentication
 *
 * The handler should be mounted on POST /mcp for standard MCP servers.
 *
 * @param server - MCP server instance
 * @param options - Handler options including authentication
 * @returns Request handler function
 *
 * @example
 * ```typescript
 * const app = express();
 * app.use(express.json());
 *
 * // Without auth
 * app.post('/mcp', createHttpHandler(server));
 *
 * // With Bearer token auth
 * app.post('/mcp', createHttpHandler(server, {
 *   auth: { token: process.env.MCP_AUTH_TOKEN! }
 * }));
 * ```
 */
export function createHttpHandler(server: MCPServer, options?: HttpHandlerOptions) {
  return async (req: HttpRequest, res: HttpResponse) => {
    try {
      // Bearer token authentication
      if (options?.auth) {
        const skipPaths = options.auth.skipPaths || [];
        const shouldSkipAuth = req.path && skipPaths.includes(req.path);

        if (!shouldSkipAuth) {
          const authHeader = req.headers.authorization;

          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json(
              createErrorResponse(null, MCPErrorCodes.UNAUTHORIZED, 'Unauthorized: Missing bearer token')
            );
          }

          const token = authHeader.substring(7);
          if (token !== options.auth.token) {
            return res.status(401).json(
              createErrorResponse(null, MCPErrorCodes.UNAUTHORIZED, 'Unauthorized: Invalid token')
            );
          }
        }
      }

      const request = req.body as JsonRpcRequest;

      // Parse error check
      if (!request || typeof request !== 'object') {
        return res.json(createErrorResponse(null, MCPErrorCodes.PARSE_ERROR, 'Invalid JSON'));
      }

      const response = await server.handleRequest(request);
      res.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.json(createErrorResponse(null, MCPErrorCodes.INTERNAL_ERROR, message));
    }
  };
}

/**
 * Create a standalone Bearer token authentication middleware for Express
 * Use this when you need more control over the authentication flow.
 *
 * @param config - Authentication configuration
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const app = express();
 * app.use(express.json());
 *
 * // Apply auth middleware to /mcp endpoint
 * const authMiddleware = createAuthMiddleware({
 *   token: process.env.MCP_AUTH_TOKEN!,
 *   skipPaths: ['/health']
 * });
 *
 * app.use('/mcp', authMiddleware);
 * app.post('/mcp', createHttpHandler(server));
 * ```
 */
export function createAuthMiddleware(config: AuthConfig) {
  return (req: HttpRequest, res: HttpResponse, next: () => void) => {
    const skipPaths = config.skipPaths || [];
    const shouldSkipAuth = req.path && skipPaths.includes(req.path);

    if (shouldSkipAuth) {
      return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(
        createErrorResponse(null, MCPErrorCodes.UNAUTHORIZED, 'Unauthorized: Missing bearer token')
      );
    }

    const token = authHeader.substring(7);
    if (token !== config.token) {
      return res.status(401).json(
        createErrorResponse(null, MCPErrorCodes.UNAUTHORIZED, 'Unauthorized: Invalid token')
      );
    }

    next();
  };
}

/**
 * Stdio handler for MCP servers
 * Processes line-delimited JSON-RPC messages from stdin
 *
 * @param server - MCP server instance
 */
export function createStdioHandler(server: MCPServer) {
  const readline = require('readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line: string) => {
    try {
      const request = JSON.parse(line) as JsonRpcRequest;
      const response = await server.handleRequest(request);
      console.log(JSON.stringify(response));
    } catch (error) {
      console.log(
        JSON.stringify(createErrorResponse(null, MCPErrorCodes.PARSE_ERROR, 'Parse error'))
      );
    }
  });

  return rl;
}
