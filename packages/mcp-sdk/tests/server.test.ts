/**
 * Tests for MCP Server
 */

import {
  MCPServer,
  createHttpHandler,
  createAuthMiddleware,
  MCPErrorCodes,
  JsonRpcRequest,
  HttpRequest,
  HttpResponse,
} from '../src';

describe('MCPServer', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
    });
  });

  describe('constructor', () => {
    it('should create a server with config', () => {
      expect(server.getConfig().name).toBe('test-server');
      expect(server.getConfig().version).toBe('1.0.0');
    });

    it('should start uninitialized', () => {
      expect(server.isInitialized()).toBe(false);
    });
  });

  describe('registerTool', () => {
    it('should register a tool', () => {
      server.registerTool(
        'test_tool',
        'A test tool',
        {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Test input' },
          },
          required: ['input'],
        },
        async (args) => ({ result: args.input })
      );

      const tools = server.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test_tool');
      expect(tools[0].description).toBe('A test tool');
    });

    it('should allow multiple tools', () => {
      server.registerTool('tool1', 'Tool 1', { type: 'object' }, async () => ({}));
      server.registerTool('tool2', 'Tool 2', { type: 'object' }, async () => ({}));

      expect(server.getTools()).toHaveLength(2);
    });
  });

  describe('unregisterTool', () => {
    it('should remove a registered tool', () => {
      server.registerTool('test_tool', 'A test tool', { type: 'object' }, async () => ({}));
      expect(server.getTools()).toHaveLength(1);

      server.unregisterTool('test_tool');
      expect(server.getTools()).toHaveLength(0);
    });
  });

  describe('handleRequest', () => {
    describe('initialize', () => {
      it('should handle initialize method', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('result');
        expect((response as any).result.protocolVersion).toBe('2024-11-05');
        expect((response as any).result.serverInfo.name).toBe('test-server');
        expect(server.isInitialized()).toBe(true);
      });
    });

    describe('tools/list', () => {
      it('should return empty tools list', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('result');
        expect((response as any).result.tools).toEqual([]);
      });

      it('should return registered tools', async () => {
        server.registerTool('get_data', 'Get some data', { type: 'object' }, async () => ({}));

        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect((response as any).result.tools).toHaveLength(1);
        expect((response as any).result.tools[0].name).toBe('get_data');
      });
    });

    describe('tools/call', () => {
      beforeEach(() => {
        server.registerTool(
          'echo',
          'Echo input back',
          {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Message to echo' },
            },
            required: ['message'],
          },
          async (args) => ({ echoed: args.message })
        );
      });

      it('should call a registered tool', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message: 'Hello' },
          },
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('result');
        expect((response as any).result.isError).toBe(false);
        const content = JSON.parse((response as any).result.content[0].text);
        expect(content.echoed).toBe('Hello');
      });

      it('should return error for unknown tool', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'unknown_tool',
            arguments: {},
          },
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('error');
        expect((response as any).error.code).toBe(MCPErrorCodes.METHOD_NOT_FOUND);
      });

      it('should return error for missing tool name', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {},
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('error');
        expect((response as any).error.code).toBe(MCPErrorCodes.INVALID_PARAMS);
      });

      it('should return tool error for missing required params', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: {}, // missing required 'message'
          },
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('result');
        expect((response as any).result.isError).toBe(true);
      });

      it('should handle tool execution errors', async () => {
        server.registerTool('failing_tool', 'A tool that fails', { type: 'object' }, async () => {
          throw new Error('Tool failed');
        });

        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'failing_tool',
            arguments: {},
          },
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('result');
        expect((response as any).result.isError).toBe(true);
        const content = JSON.parse((response as any).result.content[0].text);
        expect(content.error).toBe('Tool failed');
      });
    });

    describe('unknown method', () => {
      it('should return method not found error', async () => {
        const request: JsonRpcRequest = {
          jsonrpc: '2.0',
          method: 'unknown/method',
          id: 1,
        };

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('error');
        expect((response as any).error.code).toBe(MCPErrorCodes.METHOD_NOT_FOUND);
      });
    });

    describe('invalid request', () => {
      it('should reject invalid jsonrpc version', async () => {
        const request = {
          jsonrpc: '1.0',
          method: 'tools/list',
          id: 1,
        } as any;

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('error');
        expect((response as any).error.code).toBe(MCPErrorCodes.INVALID_REQUEST);
      });

      it('should reject missing id', async () => {
        const request = {
          jsonrpc: '2.0',
          method: 'tools/list',
        } as any;

        const response = await server.handleRequest(request);

        expect(response).toHaveProperty('error');
        expect((response as any).error.code).toBe(MCPErrorCodes.INVALID_REQUEST);
      });
    });
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      const health = await server.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.version).toBe('1.0.0');
      expect(health.timestamp).toBeDefined();
      expect(health.details?.toolCount).toBe(0);
    });
  });

  describe('initialize/shutdown', () => {
    it('should initialize server', async () => {
      expect(server.isInitialized()).toBe(false);
      await server.initialize();
      expect(server.isInitialized()).toBe(true);
    });

    it('should shutdown server', async () => {
      await server.initialize();
      expect(server.isInitialized()).toBe(true);
      await server.shutdown();
      expect(server.isInitialized()).toBe(false);
    });
  });
});

describe('createHttpHandler', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer({
      name: 'test-server',
      version: '1.0.0',
    });
    server.registerTool('test', 'Test tool', { type: 'object' }, async () => ({ ok: true }));
  });

  describe('without authentication', () => {
    it('should handle valid requests', async () => {
      const handler = createHttpHandler(server);

      const req: HttpRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
        headers: {},
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 1,
          result: expect.objectContaining({
            tools: expect.any(Array),
          }),
        })
      );
    });

    it('should handle invalid JSON', async () => {
      const handler = createHttpHandler(server);

      const req: HttpRequest = {
        body: null,
        headers: {},
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: MCPErrorCodes.PARSE_ERROR,
          }),
        })
      );
    });
  });

  describe('with Bearer token authentication', () => {
    const AUTH_TOKEN = 'test-secret-token';

    it('should accept valid Bearer token', async () => {
      const handler = createHttpHandler(server, {
        auth: { token: AUTH_TOKEN },
      });

      const req: HttpRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
        headers: {
          authorization: `Bearer ${AUTH_TOKEN}`,
        },
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.status).not.toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 1,
          result: expect.objectContaining({
            tools: expect.any(Array),
          }),
        })
      );
    });

    it('should reject missing Bearer token', async () => {
      const handler = createHttpHandler(server, {
        auth: { token: AUTH_TOKEN },
      });

      const req: HttpRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
        headers: {},
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: MCPErrorCodes.UNAUTHORIZED,
            message: 'Unauthorized: Missing bearer token',
          }),
        })
      );
    });

    it('should reject invalid Bearer token', async () => {
      const handler = createHttpHandler(server, {
        auth: { token: AUTH_TOKEN },
      });

      const req: HttpRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
        headers: {
          authorization: 'Bearer wrong-token',
        },
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: MCPErrorCodes.UNAUTHORIZED,
            message: 'Unauthorized: Invalid token',
          }),
        })
      );
    });

    it('should reject non-Bearer authorization', async () => {
      const handler = createHttpHandler(server, {
        auth: { token: AUTH_TOKEN },
      });

      const req: HttpRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
        headers: {
          authorization: 'Basic dXNlcjpwYXNz',
        },
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: MCPErrorCodes.UNAUTHORIZED,
          }),
        })
      );
    });

    it('should skip auth for specified paths', async () => {
      const handler = createHttpHandler(server, {
        auth: {
          token: AUTH_TOKEN,
          skipPaths: ['/health'],
        },
      });

      const req: HttpRequest = {
        body: {
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        },
        path: '/health',
        headers: {},
      };

      const res = {
        json: jest.fn(),
        status: jest.fn().mockReturnThis(),
      } as unknown as HttpResponse;

      await handler(req, res);

      expect(res.status).not.toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          jsonrpc: '2.0',
          id: 1,
        })
      );
    });
  });
});

describe('createAuthMiddleware', () => {
  const AUTH_TOKEN = 'test-secret-token';

  it('should call next() for valid token', () => {
    const middleware = createAuthMiddleware({ token: AUTH_TOKEN });
    const next = jest.fn();

    const req: HttpRequest = {
      body: {},
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    };

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as HttpResponse;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should reject missing token', () => {
    const middleware = createAuthMiddleware({ token: AUTH_TOKEN });
    const next = jest.fn();

    const req: HttpRequest = {
      body: {},
      headers: {},
    };

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as HttpResponse;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should reject invalid token', () => {
    const middleware = createAuthMiddleware({ token: AUTH_TOKEN });
    const next = jest.fn();

    const req: HttpRequest = {
      body: {},
      headers: {
        authorization: 'Bearer wrong-token',
      },
    };

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as HttpResponse;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should skip auth for specified paths', () => {
    const middleware = createAuthMiddleware({
      token: AUTH_TOKEN,
      skipPaths: ['/health'],
    });
    const next = jest.fn();

    const req: HttpRequest = {
      body: {},
      path: '/health',
      headers: {},
    };

    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as HttpResponse;

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
