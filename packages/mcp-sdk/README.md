# @savvagent/mcp-sdk

Model Context Protocol (MCP) SDK for Savvagent integrations. This is the base framework for building MCP servers using **StreamableHTTP transport** and JSON-RPC 2.0, allowing Savvagent to query observability data from tools like Sentry, Datadog, Splunk, and more.

## What is MCP?

MCP (Model Context Protocol) is a standardized protocol for AI systems to interact with external data sources and tools:

- **StreamableHTTP Transport**: Single HTTP endpoint (`POST /mcp`) handles all JSON-RPC requests
- **Pull-based architecture**: Savvagent queries your server for data on-demand
- **Bearer Token Auth**: Simple, secure authentication using `Authorization: Bearer <token>`
- **Tool-based interface**: Define tools that Savvagent can call

## Installation

```bash
npm install @savvagent/mcp-sdk
```

## Quick Start

### Creating an MCP Server with Bearer Token Auth

```typescript
import { MCPServer, createHttpHandler } from '@savvagent/mcp-sdk';
import express from 'express';

// Create server
const server = new MCPServer({
  name: 'my-mcp-server',
  version: '1.0.0',
});

// Register tools
server.registerTool(
  'get_service_status',
  'Get the current status of monitored services',
  {
    type: 'object',
    properties: {
      service_name: {
        type: 'string',
        description: 'Name of the service to check',
      },
    },
    required: ['service_name'],
  },
  async (args) => {
    // Your implementation here
    return { status: 'healthy', service: args.service_name };
  }
);

// Start HTTP server with Bearer token authentication
const app = express();
app.use(express.json());

// MCP endpoint with auth (StreamableHTTP)
app.post('/mcp', createHttpHandler(server, {
  auth: { token: process.env.MCP_AUTH_TOKEN! }
}));

// Health check endpoint (no auth required)
app.get('/health', async (req, res) => {
  const health = await server.healthCheck();
  res.json(health);
});

app.listen(3000, () => console.log('MCP server running on port 3000'));
```

### Testing with cURL

```bash
# List available tools (with Bearer token)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Call a tool
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_service_status","arguments":{"service_name":"api"}},"id":2}'
```

## Core Concepts

### StreamableHTTP Transport

MCP uses a single HTTP endpoint that handles all JSON-RPC requests:

```
POST /mcp HTTP/1.1
Host: your-server.example.com
Content-Type: application/json
Authorization: Bearer <your-token>

{"jsonrpc": "2.0", "method": "tools/list", "id": 1}
```

### MCPServer

The main class for building MCP servers. Register tools that Savvagent can call:

```typescript
import { MCPServer } from '@savvagent/mcp-sdk';

const server = new MCPServer({
  name: 'my-server',
  version: '1.0.0',
});

// Register a tool
server.registerTool(
  'tool_name',           // Tool name (snake_case)
  'Tool description',    // Description for the AI
  {                      // Input schema (JSON Schema)
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter description' },
    },
    required: ['param1'],
  },
  async (args) => {      // Handler function
    return { result: 'success' };
  }
);
```

### JSON-RPC 2.0 Protocol

MCP uses JSON-RPC 2.0 with these methods:

| Method | Description |
|--------|-------------|
| `initialize` | Initialize the connection (optional) |
| `tools/list` | List available tools and their schemas |
| `tools/call` | Call a tool with arguments |

### Authentication

#### Built-in Bearer Token Auth

```typescript
import { createHttpHandler } from '@savvagent/mcp-sdk';

// With authentication
app.post('/mcp', createHttpHandler(server, {
  auth: {
    token: process.env.MCP_AUTH_TOKEN!,
    skipPaths: ['/health'] // Optional: paths to skip auth
  }
}));
```

#### Standalone Auth Middleware

For more control over authentication:

```typescript
import { createAuthMiddleware, createHttpHandler } from '@savvagent/mcp-sdk';

const authMiddleware = createAuthMiddleware({
  token: process.env.MCP_AUTH_TOKEN!,
  skipPaths: ['/health']
});

app.use('/mcp', authMiddleware);
app.post('/mcp', createHttpHandler(server));
```

### Transport Options

#### HTTP/HTTPS (Recommended)

```typescript
import { createHttpHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const app = express();
app.use(express.json());

// Mount on /mcp (StreamableHTTP standard)
app.post('/mcp', createHttpHandler(server, {
  auth: { token: process.env.MCP_AUTH_TOKEN! }
}));
```

#### Stdio

```typescript
import { createStdioHandler } from '@savvagent/mcp-sdk';

// Reads JSON-RPC from stdin, writes responses to stdout
createStdioHandler(server);
```

## Type Definitions

### MCPServerConfig

```typescript
interface MCPServerConfig {
  name: string;      // Server name
  version: string;   // Server version
  options?: Record<string, any>;
}
```

### AuthConfig

```typescript
interface AuthConfig {
  token: string;           // Bearer token for authentication
  skipPaths?: string[];    // Paths to skip authentication
}
```

### MCPTool

```typescript
interface MCPTool {
  name: string;                    // Tool name
  description: string;             // Tool description
  inputSchema: ToolInputSchema;    // JSON Schema for inputs
}
```

### ToolInputSchema

```typescript
interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}
```

### JsonRpcRequest

```typescript
interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
  id: number | string;
}
```

### Error Codes

```typescript
const MCPErrorCodes = {
  PARSE_ERROR: -32700,        // Invalid JSON
  INVALID_REQUEST: -32600,    // Missing required fields
  METHOD_NOT_FOUND: -32601,   // Unknown method
  INVALID_PARAMS: -32602,     // Parameter validation failed
  INTERNAL_ERROR: -32603,     // Server-side error
  UNAUTHORIZED: -32001,       // Invalid credentials
  RATE_LIMITED: -32002,       // Too many requests
  RESOURCE_NOT_FOUND: -32003, // Data doesn't exist
};
```

## Helper Functions

```typescript
import {
  createSuccessResponse,
  createErrorResponse,
  createToolResponse,
  isErrorResponse,
  createAuthMiddleware,
} from '@savvagent/mcp-sdk';

// Create JSON-RPC responses
const success = createSuccessResponse(1, { data: 'result' });
const error = createErrorResponse(1, -32600, 'Invalid request');

// Create tool call responses
const toolResult = createToolResponse({ status: 'ok' });
const toolError = createToolResponse({ error: 'Failed' }, true);
```

## Official MCP Integrations

- [@savvagent/mcp-sentry](../mcp-sentry) - Sentry error tracking integration
- @savvagent/mcp-datadog - Datadog integration (coming soon)
- @savvagent/mcp-splunk - Splunk integration (coming soon)

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Test
npm test

# Lint
npm run lint

# Format
npm run format
```

## License

MIT

## Support

For questions and support, visit [savvagent.com/docs](https://savvagent.com/docs) or open an issue on GitHub.
