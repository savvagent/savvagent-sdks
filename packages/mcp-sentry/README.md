# @savvagent/mcp-sentry

Sentry MCP integration for Savvagent. Exposes Sentry error data via MCP tools using StreamableHTTP transport with Bearer token authentication for AI-powered error analysis and correlation.

## Features

- **get_errors**: Fetch recent error events from Sentry
- **get_error_details**: Get detailed error information including stack traces
- **get_error_events**: List individual event occurrences for an issue
- **search_errors**: Search errors by query string
- **get_service_health**: Get overall project health and statistics

## Installation

```bash
npm install @savvagent/mcp-sentry
```

## Quick Start

### 1. Create Sentry MCP Server

```typescript
import { SentryMCPServer } from '@savvagent/mcp-sentry';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const server = new SentryMCPServer(
  {
    name: 'sentry-mcp',
    version: '1.0.0',
  },
  {
    authToken: process.env.SENTRY_AUTH_TOKEN!,
    organization: process.env.SENTRY_ORG!,
    project: process.env.SENTRY_PROJECT!,
    environment: 'production',  // optional
  }
);

await server.initialize();

const app = express();
app.use(express.json());

// MCP endpoint with Bearer token auth (StreamableHTTP)
app.post('/mcp', createHttpHandler(server, {
  auth: { token: process.env.MCP_AUTH_TOKEN! }
}));

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = await server.healthCheck();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.listen(3000, () => {
  console.log('Sentry MCP server running on port 3000');
});
```

### 2. Test with cURL

```bash
# List available tools (with Bearer token)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-mcp-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Get recent errors
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-mcp-token" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_errors","arguments":{"time_range":"24h"}},"id":2}'

# Get error details
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-mcp-token" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_error_details","arguments":{"issue_id":"12345"}},"id":3}'

# Search errors
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-mcp-token" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"search_errors","arguments":{"query":"is:unresolved TypeError"}},"id":4}'

# Get service health
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-mcp-token" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_service_health","arguments":{"time_range":"24h"}},"id":5}'
```

## Configuration

### SentryConfig

```typescript
interface SentryConfig {
  authToken: string;      // Sentry API auth token
  organization: string;   // Sentry organization slug
  project: string;        // Sentry project slug
  environment?: string;   // Environment filter (optional)
  apiUrl?: string;        // Custom API URL (default: https://sentry.io/api/0)
}
```

### Getting Sentry Credentials

1. **Auth Token**: Create in Sentry → Settings → Auth Tokens
   - Required scopes: `project:read`, `event:read`, `org:read`
2. **Organization**: Your Sentry organization slug (in URL)
3. **Project**: Your Sentry project slug (in URL)

## Available Tools

### get_errors

Fetch recent error events from Sentry with counts and metadata.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| time_range | string | Time range: `1h`, `24h`, `7d`, `14d`, `30d` (default: `24h`) |
| environment | string | Environment filter |
| severity | string | Minimum severity: `debug`, `info`, `warning`, `error`, `fatal` |
| limit | integer | Max results (1-100, default: 50) |

### get_error_details

Get detailed information about a specific Sentry issue including stack trace.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| issue_id | string | Yes | The Sentry issue ID |

### get_error_events

Get recent event occurrences for a specific Sentry issue.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| issue_id | string | Yes | The Sentry issue ID |
| limit | integer | No | Max events (1-100, default: 20) |

### search_errors

Search Sentry issues by message, tag, or other criteria.

**Parameters:**
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Search query (e.g., `is:unresolved TypeError`) |
| time_range | string | No | Time range (default: `7d`) |
| limit | integer | No | Max results (1-100, default: 25) |

### get_service_health

Get health overview and statistics for the Sentry project.

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| time_range | string | Time range: `1h`, `24h`, `7d` (default: `24h`) |

## Example Server

A complete example server is provided in `example-server.ts`:

```bash
# Set environment variables
export MCP_AUTH_TOKEN=your-mcp-token        # Token for MCP authentication
export SENTRY_AUTH_TOKEN=your-sentry-token  # Token for Sentry API
export SENTRY_ORG=your-org
export SENTRY_PROJECT=your-project

# Run the example
npx ts-node example-server.ts
```

## Environment Variables

```bash
# Required for MCP authentication
MCP_AUTH_TOKEN=your-mcp-auth-token

# Required for Sentry API
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug

# Optional
SENTRY_ENVIRONMENT=production
PORT=3000
```

## API Reference

### SentryMCPServer

Extends `MCPServer` from `@savvagent/mcp-sdk`.

#### Constructor

```typescript
new SentryMCPServer(config: MCPServerConfig, sentryConfig: SentryConfig)
```

#### Methods

- `initialize()` - Initialize Sentry API client
- `healthCheck()` - Check Sentry connection health
- `shutdown()` - Cleanup and close connections
- `getTools()` - Get list of available tools
- `handleRequest(request)` - Process JSON-RPC request

## Savvagent Integration

When configuring this server in Savvagent:

1. Go to **Settings > MCP Integrations > Add Integration**
2. Select **Sentry** as the server type
3. Enter your server URL: `https://your-server.example.com/mcp`
4. Select **Bearer Token** authentication
5. Enter your MCP_AUTH_TOKEN
6. Click **Test Connection** to verify

## Troubleshooting

### Connection errors

- Verify Sentry auth token has correct scopes
- Check organization and project slugs
- Ensure API rate limits aren't exceeded

### Authentication errors

- Verify MCP_AUTH_TOKEN is set correctly
- Check the Authorization header format: `Authorization: Bearer <token>`

### No data returned

- Verify time range includes data
- Check environment filter if set
- Confirm project has error data

### API errors

- Check Sentry service status
- Review error message for details
- Ensure Sentry auth token is valid

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

# Run example server
npm run example
```

## License

MIT

## Support

- Documentation: [savvagent.com/docs/integrations/sentry](https://savvagent.com/docs/integrations/sentry)
- Issues: [GitHub Issues](https://github.com/savvagent/savvagent-sdks/issues)
