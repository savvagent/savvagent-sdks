# MCP Server Development Guide

This guide provides comprehensive documentation for building MCP (Model Context Protocol) servers compatible with Savvagent's AI-powered feature flag platform.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Protocol Specification](#2-protocol-specification)
3. [Building Your First MCP Server](#3-building-your-first-mcp-server)
4. [Tool Design Best Practices](#4-tool-design-best-practices)
5. [Authentication](#5-authentication)
6. [Testing & Debugging](#6-testing--debugging)
7. [Deployment](#7-deployment)
8. [Examples](#8-examples)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Introduction

### What is MCP?

MCP (Model Context Protocol) is a standardized protocol for AI systems to interact with external data sources and tools. Savvagent uses MCP to connect with your observability tools like Sentry, Datadog, and custom monitoring systems.

### Architecture Overview

**You run your own MCP server.** Savvagent connects to it as a client.

```
┌────────────────────┐              ┌──────────────────────┐
│  Savvagent Backend │   HTTPS +    │  Your MCP Server     │
│  (MCP Client)      │──Bearer───▶  │  (StreamableHTTP)    │
│                    │   Token      │                      │
│  - Scheduler       │              │  - get_errors        │
│  - AI Analysis     │◀─────────────│  - get_metrics       │
│                    │   JSON-RPC   │  - get_traces        │
└────────────────────┘              └──────────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────────┐
                                    │  Your Observability  │
                                    │  Tools (Sentry, etc) │
                                    └──────────────────────┘
```

### Key Concepts

- **StreamableHTTP Transport**: Single HTTP endpoint (`POST /mcp`) handles all JSON-RPC requests
- **Bearer Token Auth**: Simple, secure authentication using `Authorization: Bearer <token>`
- **Pull-Based**: Savvagent pulls data from your server on a schedule you configure
- **Tools**: Your server exposes tools that Savvagent calls to fetch observability data

### Pull-Based vs Push-Based Architecture

| Aspect | Pull-Based (MCP) | Push-Based (Webhooks) |
|--------|-----------------|----------------------|
| Control | Savvagent controls data collection timing | External system controls timing |
| AI Integration | AI can request specific data on-demand | Data arrives regardless of AI needs |
| Flexibility | Query for exactly what's needed | Receive all events (over-fetching) |
| Reliability | Retry logic in Savvagent | Must handle webhook failures |
| Rate Limiting | Savvagent manages query frequency | Must handle rate limits externally |

### When to Build an MCP Server

Build an MCP server when you want Savvagent to:
- Correlate errors from your monitoring tools with feature flag changes
- Automatically detect issues caused by flag rollouts
- Get AI-powered analysis of your observability data

You'll build a server that:
- Connects to your observability tool (Sentry, Datadog, Splunk, etc.)
- Exposes MCP tools like `get_errors`, `get_metrics`
- Returns data in a format Savvagent's AI can analyze

---

## 2. Protocol Specification

### StreamableHTTP Transport

MCP uses **StreamableHTTP** transport - a single HTTP endpoint that handles all JSON-RPC requests:

```
POST /mcp HTTP/1.1
Host: your-server.example.com
Content-Type: application/json
Authorization: Bearer <your-token>

{"jsonrpc": "2.0", "method": "tools/list", "id": 1}
```

All requests go to the same endpoint (e.g., `POST /mcp` or `POST /`). The `method` field in the JSON-RPC body determines what action to take.

### JSON-RPC 2.0 Format

**Request Format:**
```json
{
  "jsonrpc": "2.0",
  "method": "method_name",
  "params": { ... },
  "id": 1
}
```

**Success Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}
```

**Error Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": { "details": "..." }
  }
}
```

### Required Methods

Every MCP server must implement these two methods:

#### `tools/list`

Returns the list of available tools and their schemas.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 1
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "get_errors",
        "description": "Fetch recent error events from the monitoring system",
        "inputSchema": {
          "type": "object",
          "properties": {
            "time_range": {
              "type": "string",
              "description": "Time range for query (1h, 24h, 7d)",
              "enum": ["1h", "24h", "7d"]
            },
            "environment": {
              "type": "string",
              "description": "Environment filter (production, staging)"
            },
            "limit": {
              "type": "integer",
              "description": "Maximum number of results",
              "default": 50,
              "minimum": 1,
              "maximum": 500
            }
          },
          "required": ["time_range"]
        }
      }
    ]
  }
}
```

#### `tools/call`

Invokes a specific tool with parameters.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_errors",
    "arguments": {
      "time_range": "1h",
      "environment": "production",
      "limit": 25
    }
  },
  "id": 2
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"errors\": [{\"id\": \"abc123\", \"message\": \"TypeError: Cannot read property 'x'\", \"count\": 150, \"first_seen\": \"2024-11-29T10:00:00Z\"}], \"total\": 15}"
      }
    ],
    "isError": false
  }
}
```

### Optional Methods

#### `initialize`

Called when the client first connects. Useful for version negotiation.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {
      "name": "savvagent-mcp-client",
      "version": "1.0.0"
    }
  },
  "id": 0
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "my-custom-mcp-server",
      "version": "1.0.0"
    },
    "capabilities": {
      "tools": {}
    }
  }
}
```

### Error Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Missing required fields |
| -32601 | Method not found | Unknown method name |
| -32602 | Invalid params | Parameter validation failed |
| -32603 | Internal error | Server-side error |
| -32001 | Unauthorized | Invalid or missing credentials |
| -32002 | Rate limited | Too many requests |
| -32003 | Resource not found | Requested data doesn't exist |

### Content Types

Tool responses can include different content types:

**Text (most common):**
```json
{
  "type": "text",
  "text": "{\"data\": ...}"
}
```

**Image:**
```json
{
  "type": "image",
  "data": "base64-encoded-image-data",
  "mimeType": "image/png"
}
```

**Resource:**
```json
{
  "type": "resource",
  "resource": {
    "uri": "file:///path/to/resource",
    "text": "Resource content"
  }
}
```

---

## 3. Building Your First MCP Server

### Minimal Example (Node.js/TypeScript)

Here's a complete, working MCP server with Bearer token authentication:

```typescript
// mcp-server.ts
import express, { Request, Response, NextFunction } from 'express';

const app = express();
app.use(express.json());

// Bearer token authentication middleware
function authenticate(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health check
  if (req.path === '/health') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: Missing bearer token' }
    });
  }

  const token = authHeader.substring(7);
  if (token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: Invalid token' }
    });
  }

  next();
}

app.use(authenticate);

// Tool definitions
const tools = [
  {
    name: 'get_status',
    description: 'Get current system status',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_errors',
    description: 'Get recent error events',
    inputSchema: {
      type: 'object',
      properties: {
        time_range: {
          type: 'string',
          description: 'Time range (1h, 24h, 7d)',
          enum: ['1h', '24h', '7d']
        }
      },
      required: ['time_range']
    }
  }
];

// Helper to create JSON-RPC response
function jsonRpcResponse(id: number, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: number, code: number, message: string, data?: any) {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

// Single MCP endpoint (StreamableHTTP)
app.post('/mcp', async (req: Request, res: Response) => {
  const { method, params, id } = req.body;

  try {
    switch (method) {
      case 'initialize':
        res.json(jsonRpcResponse(id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'my-mcp-server', version: '1.0.0' },
          capabilities: { tools: {} }
        }));
        break;

      case 'tools/list':
        res.json(jsonRpcResponse(id, { tools }));
        break;

      case 'tools/call':
        const { name, arguments: args } = params;
        let result;

        switch (name) {
          case 'get_status':
            result = { status: 'healthy', timestamp: new Date().toISOString() };
            break;
          case 'get_errors':
            // In production: fetch from your observability tool here
            result = {
              errors: [
                { id: '1', message: 'Sample error', count: 10 }
              ],
              total: 1,
              time_range: args?.time_range || '1h'
            };
            break;
          default:
            return res.json(jsonRpcError(id, -32601, `Unknown tool: ${name}`));
        }

        res.json(jsonRpcResponse(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          isError: false
        }));
        break;

      default:
        res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    res.json(jsonRpcError(id, -32603, (error as Error).message));
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP server running on port ${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/mcp`);
});
```

**Run with:**
```bash
# Install dependencies
npm init -y
npm install express typescript ts-node @types/express @types/node

# Set your auth token
export MCP_AUTH_TOKEN="your-secret-token"

# Run the server
npx ts-node mcp-server.ts
```

**Test with curl:**
```bash
# Test tools/list (with Bearer token)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Test tools/call
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{"name":"get_errors","arguments":{"time_range":"1h"}},
    "id":2
  }'
```

### Configure in Savvagent

Once your server is running, add it in Savvagent:

1. Go to **Settings > MCP Integrations > Add Integration**
2. Select server type (e.g., "Sentry" or "Custom MCP Server")
3. Enter your server URL: `https://your-server.example.com/mcp`
4. Select **Bearer Token** authentication
5. Enter your token
6. Click **Test Connection** to verify

---

## 4. Tool Design Best Practices

### Naming Conventions

Follow these naming patterns:
- Use `snake_case`: `get_errors`, `list_traces`, `search_logs`
- Start with a verb: `get_`, `list_`, `search_`, `create_`, `analyze_`
- Be specific: `get_errors` not `get_data`
- Group related tools: `get_errors`, `get_error_details`, `search_errors`

**Good Examples:**
```
get_errors          - Fetch error events
get_traces          - Fetch distributed traces
get_metrics         - Fetch time-series metrics
search_logs         - Query log entries
get_service_health  - Get service status overview
```

**Bad Examples:**
```
errors              - Not a verb
getData             - camelCase (use snake_case)
fetch_all           - Too vague
```

### Input Schema Design

Use JSON Schema draft-07 for input schemas:

```json
{
  "type": "object",
  "properties": {
    "time_range": {
      "type": "string",
      "description": "Time range for the query",
      "enum": ["15m", "1h", "6h", "24h", "7d", "30d"],
      "default": "1h"
    },
    "environment": {
      "type": "string",
      "description": "Environment to filter by",
      "examples": ["production", "staging", "development"]
    },
    "severity": {
      "type": "string",
      "description": "Minimum severity level",
      "enum": ["debug", "info", "warning", "error", "fatal"],
      "default": "error"
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of results to return",
      "minimum": 1,
      "maximum": 500,
      "default": 50
    },
    "offset": {
      "type": "integer",
      "description": "Number of results to skip (for pagination)",
      "minimum": 0,
      "default": 0
    }
  },
  "required": ["time_range"],
  "additionalProperties": false
}
```

**Best Practices:**
- Always provide `description` for every property
- Use `enum` for constrained values
- Set sensible `default` values
- Include `minimum`/`maximum` for numeric values
- Use `examples` for free-form strings
- Mark truly required fields in `required` array

### Output Format Guidelines

**Keep responses under 100KB.** Large responses slow down AI analysis.

**Use pagination for large datasets:**
```json
{
  "errors": [...],
  "pagination": {
    "total": 1500,
    "limit": 50,
    "offset": 0,
    "has_more": true
  }
}
```

**Include metadata:**
```json
{
  "errors": [...],
  "meta": {
    "query_time_ms": 234,
    "time_range": "1h",
    "environment": "production",
    "timestamp": "2024-11-29T12:00:00Z"
  }
}
```

**Structure data consistently:**
```json
{
  "errors": [
    {
      "id": "abc123",
      "message": "TypeError: Cannot read property 'x'",
      "count": 150,
      "first_seen": "2024-11-29T10:00:00Z",
      "last_seen": "2024-11-29T12:00:00Z",
      "environment": "production",
      "severity": "error",
      "stack_trace": "...",
      "tags": {
        "browser": "Chrome",
        "os": "Windows"
      }
    }
  ],
  "total": 15
}
```

### Recommended Tools by Domain

**Error Tracking (Sentry, Bugsnag, Rollbar):**
```
get_errors         - Recent errors with counts
get_error_details  - Full error with stack trace
search_errors      - Query errors by message/tag
get_issue          - Get specific issue by ID
```

**APM/Metrics (Datadog, NewRelic):**
```
get_metrics        - Time-series metrics
get_traces         - Distributed traces
get_service_health - Service dependency map
query_metric       - Custom metric query
```

**Logging (Splunk, Elasticsearch):**
```
search_logs        - Query log entries
get_log_patterns   - Aggregated log patterns
get_anomalies      - Detected log anomalies
get_log_context    - Surrounding log lines
```

**Custom Business Metrics:**
```
get_conversion_rate  - Conversion funnel metrics
get_revenue_impact   - Revenue per flag variant
get_user_segments    - Segment performance
get_ab_results       - A/B test statistics
```

---

## 5. Authentication

Savvagent uses **Bearer token authentication** to connect to your MCP server.

### How It Works

1. You generate a secret token for your MCP server
2. Configure the token in Savvagent when adding the integration
3. Savvagent sends `Authorization: Bearer <token>` with every request
4. Your server validates the token

### Server-Side Implementation

```typescript
function authenticate(req: Request, res: Response, next: NextFunction) {
  // Skip auth for health checks
  if (req.path === '/health') return next();

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: Missing bearer token' }
    });
  }

  const token = authHeader.substring(7);
  if (token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: Invalid token' }
    });
  }

  next();
}

app.use(authenticate);
```

### Generating Tokens

Generate a secure random token:

```bash
# Using openssl
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the token securely (environment variable, secrets manager).

### Security Best Practices

- **Use HTTPS in production** - Never send tokens over plain HTTP
- **Rotate tokens regularly** - Every 90 days is a good practice
- **Never log tokens** - Mask or omit Authorization headers in logs
- **Use environment variables** - Don't hardcode tokens in source code
- **Validate on every request** - Don't cache authentication state

### Rate Limiting (Recommended)

Protect your server from abuse:

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  handler: (req, res) => {
    res.status(429).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32002, message: 'Rate limit exceeded' }
    });
  }
});

app.use(limiter);
```

### Future: OAuth 2.1

MCP supports full OAuth 2.1 authorization flows for enterprise scenarios. This includes:
- Protected Resource Metadata discovery
- Authorization Code flow with PKCE
- Token refresh

Savvagent currently supports Bearer tokens. OAuth 2.1 support is planned for a future release.

---

## 6. Testing & Debugging

### Local Testing

**Test tools/list:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

**Test tools/call:**
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{
      "name":"get_errors",
      "arguments":{"time_range":"1h","environment":"production"}
    },
    "id":2
  }'
```

### Using Savvagent's Test Connection

When you configure an MCP integration in Savvagent, the "Test Connection" feature:

1. Calls `GET /health` (optional)
2. Calls `POST /mcp` with `tools/list` method
3. Calls a simple tool if available

Ensure your server responds correctly to these requests before deploying.

### Mock MCP Client for Development

```typescript
// test-mcp-client.ts
async function testMcpServer(baseUrl: string, token: string) {
  const client = {
    async call(method: string, params?: any) {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method,
          params,
          id: Date.now()
        })
      });
      return response.json();
    }
  };

  // Test initialize
  console.log('Testing initialize...');
  console.log(await client.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  }));

  // Test tools/list
  console.log('\nTesting tools/list...');
  const toolsResponse = await client.call('tools/list');
  console.log(JSON.stringify(toolsResponse, null, 2));

  // Test each tool
  if (toolsResponse.result?.tools) {
    for (const tool of toolsResponse.result.tools) {
      console.log(`\nTesting tool: ${tool.name}...`);
      const result = await client.call('tools/call', {
        name: tool.name,
        arguments: getTestArgs(tool)
      });
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

function getTestArgs(tool: any) {
  const args: any = {};
  const props = tool.inputSchema?.properties || {};

  for (const [key, schema] of Object.entries(props) as any) {
    if (schema.default !== undefined) {
      args[key] = schema.default;
    } else if (schema.enum) {
      args[key] = schema.enum[0];
    } else if (schema.type === 'string') {
      args[key] = 'test';
    } else if (schema.type === 'integer') {
      args[key] = schema.minimum || 1;
    }
  }

  return args;
}

// Run tests
testMcpServer('http://localhost:3000/mcp', 'your-secret-token');
```

### Integration Tests

```typescript
// mcp-server.test.ts
import request from 'supertest';
import { app } from './mcp-server';

const AUTH_TOKEN = 'test-token';

describe('MCP Server', () => {
  describe('tools/list', () => {
    it('returns valid tool list', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${AUTH_TOKEN}`)
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

      expect(response.status).toBe(200);
      expect(response.body.jsonrpc).toBe('2.0');
      expect(response.body.result.tools).toBeInstanceOf(Array);
      expect(response.body.result.tools.length).toBeGreaterThan(0);

      for (const tool of response.body.result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      }
    });
  });

  describe('tools/call', () => {
    it('handles valid tool call', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${AUTH_TOKEN}`)
        .send({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'get_status', arguments: {} },
          id: 2
        });

      expect(response.status).toBe(200);
      expect(response.body.result.isError).toBe(false);
      expect(response.body.result.content).toBeInstanceOf(Array);
    });

    it('returns error for unknown tool', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', `Bearer ${AUTH_TOKEN}`)
        .send({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'unknown_tool', arguments: {} },
          id: 3
        });

      expect(response.status).toBe(200);
      expect(response.body.error).toBeDefined();
      expect(response.body.error.code).toBe(-32601);
    });
  });

  describe('authentication', () => {
    it('rejects requests without bearer token', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

      expect(response.status).toBe(401);
    });

    it('rejects requests with invalid token', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer invalid-token')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 });

      expect(response.status).toBe(401);
    });
  });
});
```

### Debugging Tips

**Enable verbose logging:**
```typescript
const DEBUG = process.env.DEBUG === 'true';

app.use((req, res, next) => {
  if (DEBUG) {
    console.log('Request:', JSON.stringify(req.body, null, 2));
  }
  next();
});

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (DEBUG) {
      console.log('Response:', JSON.stringify(body, null, 2));
    }
    return originalJson(body);
  };
  next();
});
```

**Common issues:**

| Problem | Cause | Solution |
|---------|-------|----------|
| "No tools found" | Empty tools array | Verify `tools/list` returns tools |
| "Tool call failed" | Wrong params format | Check `params.name` and `params.arguments` |
| "Connection timeout" | Slow response | Ensure response in <30s |
| "Invalid JSON" | Malformed response | Validate JSON output |
| "Authentication failed" | Wrong header format | Check `Authorization` header |

---

## 7. Deployment

### Cloud Deployment (Standalone Service)

**Docker Containerization:**

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "dist/mcp-server.js"]
```

**docker-compose.yml:**
```yaml
version: '3.8'

services:
  mcp-server:
    build: .
    ports:
      - "3000:3000"
    environment:
      - API_KEY=${API_KEY}
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Serverless Deployment

**AWS Lambda (with API Gateway):**

```typescript
// lambda.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { handleMcpRequest } from './mcp-handler';

export const handler: APIGatewayProxyHandler = async (event) => {
  const body = JSON.parse(event.body || '{}');
  const result = await handleMcpRequest(body);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result)
  };
};
```

**serverless.yml:**
```yaml
service: mcp-server

provider:
  name: aws
  runtime: nodejs20.x
  region: us-east-1

functions:
  mcp:
    handler: lambda.handler
    events:
      - http:
          path: /
          method: post
    environment:
      API_KEY: ${ssm:/mcp-server/api-key}
```

### Sidecar Pattern

Deploy alongside your application:

```yaml
# kubernetes deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: my-app:latest
        - name: mcp-sidecar
          image: my-mcp-server:latest
          ports:
            - containerPort: 3000
          env:
            - name: PROMETHEUS_URL
              value: "http://localhost:9090"
```

### Production Checklist

- [ ] Health check endpoint implemented
- [ ] Authentication enabled
- [ ] Rate limiting configured
- [ ] Request logging enabled
- [ ] Error handling comprehensive
- [ ] Timeouts configured (<30s)
- [ ] Response size limited (<100KB)
- [ ] HTTPS enabled (for HTTP transport)
- [ ] Secrets in environment variables
- [ ] Monitoring/alerting set up

---

## 8. Examples

### Complete Observability MCP Server

Here's a feature-complete example with multiple tools, authentication, rate limiting, and proper error handling:

```typescript
// observability-mcp-server.ts
import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

const app = express();
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  handler: (req, res) => {
    res.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32002, message: 'Rate limit exceeded. Try again later.' }
    });
  }
});
app.use(limiter);

// Bearer token authentication middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: Missing bearer token' }
    });
  }

  const token = authHeader.substring(7);
  if (token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Unauthorized: Invalid token' }
    });
  }
  next();
});

// Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      method: req.body?.method,
      tool: req.body?.params?.name,
      duration_ms: Date.now() - start,
      status: res.statusCode
    }));
  });
  next();
});

// Tool definitions
const tools = [
  {
    name: 'get_errors',
    description: 'Fetch recent error events from the monitoring system',
    inputSchema: {
      type: 'object',
      properties: {
        time_range: {
          type: 'string',
          description: 'Time range (1h, 24h, 7d)',
          enum: ['1h', '24h', '7d']
        },
        environment: {
          type: 'string',
          description: 'Environment filter'
        },
        severity: {
          type: 'string',
          description: 'Minimum severity',
          enum: ['warning', 'error', 'fatal'],
          default: 'error'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 50
        }
      },
      required: ['time_range']
    }
  },
  {
    name: 'get_error_details',
    description: 'Get detailed information about a specific error',
    inputSchema: {
      type: 'object',
      properties: {
        error_id: {
          type: 'string',
          description: 'The unique error identifier'
        }
      },
      required: ['error_id']
    }
  },
  {
    name: 'get_metrics',
    description: 'Fetch time-series metrics',
    inputSchema: {
      type: 'object',
      properties: {
        metric_name: {
          type: 'string',
          description: 'Metric name to query'
        },
        time_range: {
          type: 'string',
          enum: ['15m', '1h', '6h', '24h']
        },
        aggregation: {
          type: 'string',
          enum: ['avg', 'sum', 'min', 'max', 'p50', 'p95', 'p99'],
          default: 'avg'
        }
      },
      required: ['metric_name', 'time_range']
    }
  },
  {
    name: 'get_traces',
    description: 'Fetch distributed traces',
    inputSchema: {
      type: 'object',
      properties: {
        trace_id: {
          type: 'string',
          description: 'Specific trace ID (optional)'
        },
        service_name: {
          type: 'string',
          description: 'Filter by service'
        },
        min_duration_ms: {
          type: 'integer',
          description: 'Minimum trace duration in ms'
        },
        time_range: {
          type: 'string',
          enum: ['15m', '1h', '6h'],
          default: '1h'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 20
        }
      },
      required: []
    }
  },
  {
    name: 'get_service_health',
    description: 'Get health status of monitored services',
    inputSchema: {
      type: 'object',
      properties: {
        service_name: {
          type: 'string',
          description: 'Specific service (optional, returns all if empty)'
        }
      },
      required: []
    }
  }
];

// Tool implementations
class ObservabilityClient {
  async getErrors(args: any) {
    // In production, this would query your actual observability system
    return {
      errors: [
        {
          id: 'err-001',
          message: 'TypeError: Cannot read property \'x\' of undefined',
          count: 150,
          first_seen: '2024-11-29T10:00:00Z',
          last_seen: '2024-11-29T12:00:00Z',
          severity: 'error',
          environment: args.environment || 'production',
          affected_users: 45,
          stack_trace: 'at processOrder (checkout.js:234)\nat handleSubmit (form.js:89)',
          tags: { feature_flag: 'new-checkout', browser: 'Chrome' }
        }
      ],
      meta: {
        total: 1,
        time_range: args.time_range,
        query_time_ms: 45
      }
    };
  }

  async getErrorDetails(args: any) {
    return {
      id: args.error_id,
      message: 'TypeError: Cannot read property \'x\' of undefined',
      count: 150,
      first_seen: '2024-11-29T10:00:00Z',
      last_seen: '2024-11-29T12:00:00Z',
      severity: 'error',
      full_stack_trace: `TypeError: Cannot read property 'x' of undefined
    at processOrder (checkout.js:234)
    at handleSubmit (form.js:89)
    at HTMLFormElement.<anonymous> (index.js:45)`,
      breadcrumbs: [
        { type: 'navigation', data: { to: '/checkout' }, timestamp: '2024-11-29T11:59:55Z' },
        { type: 'click', data: { target: '#submit-btn' }, timestamp: '2024-11-29T11:59:59Z' }
      ],
      context: {
        user_id: 'user-123',
        session_id: 'sess-456',
        feature_flags: { 'new-checkout': true }
      }
    };
  }

  async getMetrics(args: any) {
    return {
      metric_name: args.metric_name,
      time_range: args.time_range,
      aggregation: args.aggregation || 'avg',
      data_points: [
        { timestamp: '2024-11-29T11:00:00Z', value: 45.2 },
        { timestamp: '2024-11-29T11:15:00Z', value: 48.7 },
        { timestamp: '2024-11-29T11:30:00Z', value: 52.1 },
        { timestamp: '2024-11-29T11:45:00Z', value: 47.3 },
        { timestamp: '2024-11-29T12:00:00Z', value: 44.8 }
      ],
      statistics: {
        min: 44.8,
        max: 52.1,
        avg: 47.62,
        p95: 51.5
      }
    };
  }

  async getTraces(args: any) {
    return {
      traces: [
        {
          trace_id: 'trace-abc123',
          service_name: 'checkout-service',
          operation: 'POST /api/orders',
          duration_ms: 234,
          status: 'ok',
          timestamp: '2024-11-29T12:00:00Z',
          spans: [
            { name: 'http.request', duration_ms: 234, status: 'ok' },
            { name: 'db.query', duration_ms: 45, status: 'ok' },
            { name: 'payment.process', duration_ms: 156, status: 'ok' }
          ]
        }
      ],
      meta: {
        total: 1,
        time_range: args.time_range || '1h',
        query_time_ms: 89
      }
    };
  }

  async getServiceHealth(args: any) {
    return {
      services: [
        {
          name: 'checkout-service',
          status: 'healthy',
          uptime_percent: 99.95,
          avg_response_time_ms: 45,
          error_rate_percent: 0.12,
          requests_per_minute: 1250
        },
        {
          name: 'payment-service',
          status: 'degraded',
          uptime_percent: 99.80,
          avg_response_time_ms: 234,
          error_rate_percent: 1.5,
          requests_per_minute: 890
        }
      ],
      timestamp: new Date().toISOString()
    };
  }
}

const client = new ObservabilityClient();

// Helper functions
function jsonRpcResponse(id: number, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: number, code: number, message: string, data?: any) {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

function toolResponse(data: any, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError
  };
}

// Single MCP endpoint (StreamableHTTP)
app.post('/mcp', async (req: Request, res: Response) => {
  const { method, params, id } = req.body;

  if (!method || id === undefined) {
    return res.json(jsonRpcError(0, -32600, 'Invalid Request: missing method or id'));
  }

  try {
    switch (method) {
      case 'initialize':
        res.json(jsonRpcResponse(id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'observability-mcp-server', version: '1.0.0' },
          capabilities: { tools: {} }
        }));
        break;

      case 'tools/list':
        res.json(jsonRpcResponse(id, { tools }));
        break;

      case 'tools/call':
        const { name, arguments: args } = params || {};

        if (!name) {
          return res.json(jsonRpcError(id, -32602, 'Missing tool name'));
        }

        let result;
        switch (name) {
          case 'get_errors':
            result = await client.getErrors(args || {});
            break;
          case 'get_error_details':
            if (!args?.error_id) {
              return res.json(jsonRpcResponse(id, toolResponse(
                { error: 'error_id is required' }, true
              )));
            }
            result = await client.getErrorDetails(args);
            break;
          case 'get_metrics':
            if (!args?.metric_name || !args?.time_range) {
              return res.json(jsonRpcResponse(id, toolResponse(
                { error: 'metric_name and time_range are required' }, true
              )));
            }
            result = await client.getMetrics(args);
            break;
          case 'get_traces':
            result = await client.getTraces(args || {});
            break;
          case 'get_service_health':
            result = await client.getServiceHealth(args || {});
            break;
          default:
            return res.json(jsonRpcError(id, -32601, `Unknown tool: ${name}`));
        }

        res.json(jsonRpcResponse(id, toolResponse(result)));
        break;

      default:
        res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    console.error('Error handling request:', error);
    res.json(jsonRpcError(id, -32603, 'Internal error', {
      message: (error as Error).message
    }));
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Observability MCP server running on port ${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/mcp`);
});

export { app };
```

### Python Example

```python
# mcp_server.py
from flask import Flask, request, jsonify
from functools import wraps
import os
from datetime import datetime

app = Flask(__name__)

# Bearer token authentication decorator
def require_bearer_token(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({
                'jsonrpc': '2.0',
                'id': None,
                'error': {'code': -32001, 'message': 'Unauthorized: Missing bearer token'}
            }), 401

        token = auth_header[7:]  # Remove 'Bearer ' prefix
        if token != os.environ.get('MCP_AUTH_TOKEN'):
            return jsonify({
                'jsonrpc': '2.0',
                'id': None,
                'error': {'code': -32001, 'message': 'Unauthorized: Invalid token'}
            }), 401
        return f(*args, **kwargs)
    return decorated

# Tool definitions
TOOLS = [
    {
        'name': 'get_errors',
        'description': 'Fetch recent errors',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'time_range': {
                    'type': 'string',
                    'enum': ['1h', '24h', '7d']
                }
            },
            'required': ['time_range']
        }
    }
]

def handle_tools_list(request_id):
    return {
        'jsonrpc': '2.0',
        'id': request_id,
        'result': {'tools': TOOLS}
    }

def handle_tools_call(request_id, params):
    name = params.get('name')
    args = params.get('arguments', {})

    if name == 'get_errors':
        result = {
            'errors': [{'id': '1', 'message': 'Sample error'}],
            'time_range': args.get('time_range', '1h')
        }
        return {
            'jsonrpc': '2.0',
            'id': request_id,
            'result': {
                'content': [{'type': 'text', 'text': str(result)}],
                'isError': False
            }
        }

    return {
        'jsonrpc': '2.0',
        'id': request_id,
        'error': {'code': -32601, 'message': f'Unknown tool: {name}'}
    }

@app.route('/mcp', methods=['POST'])
@require_bearer_token
def handle_rpc():
    data = request.get_json()
    method = data.get('method')
    params = data.get('params', {})
    request_id = data.get('id', 0)

    if method == 'tools/list':
        return jsonify(handle_tools_list(request_id))
    elif method == 'tools/call':
        return jsonify(handle_tools_call(request_id, params))
    else:
        return jsonify({
            'jsonrpc': '2.0',
            'id': request_id,
            'error': {'code': -32601, 'message': f'Method not found: {method}'}
        })

@app.route('/health')
def health():
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.utcnow().isoformat()
    })

if __name__ == '__main__':
    app.run(port=3000)
```

---

## 9. Troubleshooting

### Common Issues and Solutions

#### "No tools found"

**Symptoms:** Savvagent shows "No tools found" after connection test.

**Causes:**
1. `tools/list` returns empty array
2. Invalid JSON structure
3. Wrong endpoint

**Solution:**
```bash
# Verify your server returns tools
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}
```

#### "Tool call failed"

**Symptoms:** Tools listed but calls fail.

**Causes:**
1. Wrong `params` structure (use `params.name` and `params.arguments`)
2. Missing required arguments
3. Server throws unhandled exception

**Solution:**
Check your `tools/call` handler:
```typescript
// Correct structure
const { name, arguments: args } = params;  // Note: 'arguments', not 'args'
```

#### "Connection timeout"

**Symptoms:** Connection test times out.

**Causes:**
1. Server takes >30 seconds to respond
2. Network/firewall issues
3. Server not running

**Solution:**
- Ensure response time <30 seconds
- Check firewall rules
- Verify server is accessible from Savvagent's network

#### "Authentication failed"

**Symptoms:** 401 errors in logs.

**Causes:**
1. Wrong header name (should be `Authorization` or `X-API-Key`)
2. Credentials not configured in Savvagent
3. Token expired

**Solution:**
```bash
# Test authentication
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

#### "Invalid JSON response"

**Symptoms:** Parse errors in Savvagent logs.

**Causes:**
1. Response isn't valid JSON
2. Missing `jsonrpc` or `id` fields
3. Incorrect content-type header

**Solution:**
Validate your responses:
```typescript
// Always return valid JSON-RPC 2.0
res.json({
  jsonrpc: '2.0',  // Required
  id: req.body.id, // Required - echo back the request id
  result: { ... }  // or error: { code, message }
});
```

### Debug Checklist

1. **Verify server is running:**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Test tools/list:**
   ```bash
   curl -X POST http://localhost:3000 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
   ```

3. **Test tools/call:**
   ```bash
   curl -X POST http://localhost:3000 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_status","arguments":{}},"id":2}'
   ```

4. **Check response format:**
   - Has `jsonrpc: "2.0"`
   - Has matching `id`
   - Has `result` or `error`
   - Content-Type is `application/json`

5. **Verify authentication:**
   - Correct header name
   - Correct credential value
   - Credentials configured in Savvagent

### Getting Help

- Check server logs for detailed error messages
- Enable verbose logging during development
- Use the mock client to test locally
- Review the JSON-RPC 2.0 specification
- Contact Savvagent support with server logs

---

## Appendix: Quick Reference

### MCP Protocol Cheat Sheet

```
┌────────────────────────────────────────────────────────────────┐
│                    MCP over StreamableHTTP                      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Endpoint: POST /mcp                                            │
│  Auth:     Authorization: Bearer <token>                        │
│                                                                 │
│  Request Format:                                                │
│  {                                                              │
│    "jsonrpc": "2.0",                                           │
│    "method": "tools/list" | "tools/call" | "initialize",       │
│    "params": { ... },     // optional                          │
│    "id": 1                // required                          │
│  }                                                              │
│                                                                 │
│  Success Response:                                              │
│  {                                                              │
│    "jsonrpc": "2.0",                                           │
│    "id": 1,                                                    │
│    "result": { ... }                                           │
│  }                                                              │
│                                                                 │
│  Error Response:                                                │
│  {                                                              │
│    "jsonrpc": "2.0",                                           │
│    "id": 1,                                                    │
│    "error": { "code": -32600, "message": "..." }               │
│  }                                                              │
│                                                                 │
│  tools/call Response:                                           │
│  {                                                              │
│    "content": [{ "type": "text", "text": "..." }],             │
│    "isError": false                                            │
│  }                                                              │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Error Codes Reference

| Code | Name | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Malformed request |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Bad parameters |
| -32603 | Internal error | Server error |
| -32001 | Unauthorized | Auth failed |
| -32002 | Rate limited | Too many requests |

### Savvagent Integration Config

When adding an MCP integration in Savvagent, you'll provide:

| Field | Description | Example |
|-------|-------------|---------|
| Server Type | Category of your server | Sentry, Datadog, Custom |
| Server URL | Your MCP endpoint | `https://mcp.example.com/mcp` |
| Auth Type | Bearer Token | Bearer |
| Token | Your secret token | `abc123...` |

---

**Document Version:** 2.0
**Last Updated:** 2025-11-29
**Reference:** [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
