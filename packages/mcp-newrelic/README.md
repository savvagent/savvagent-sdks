# @savvagent/mcp-newrelic

New Relic MCP integration for Savvagent - Connect feature flags with New Relic APM and monitoring.

## Installation

```bash
npm install @savvagent/mcp-newrelic
# or
pnpm add @savvagent/mcp-newrelic
```

## Quick Start

```typescript
import express from 'express';
import { NewRelicMCPServer } from '@savvagent/mcp-newrelic';
import { createHttpHandler } from '@savvagent/mcp-sdk';

const app = express();
app.use(express.json());

const mcpServer = new NewRelicMCPServer(
  {
    name: 'my-newrelic-server',
    version: '1.0.0',
  },
  {
    apiKey: process.env.NEW_RELIC_API_KEY!,
    accountId: process.env.NEW_RELIC_ACCOUNT_ID!,
    region: 'US', // or 'EU'
  }
);

// Create handler with Bearer token authentication
const handler = createHttpHandler(mcpServer, {
  auth: { token: process.env.MCP_AUTH_TOKEN! },
});

// Mount on /mcp endpoint (StreamableHTTP transport)
app.post('/mcp', handler);

await mcpServer.initialize();
app.listen(3006);
```

## Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiKey` | string | Yes | New Relic User API key |
| `accountId` | string | Yes | New Relic Account ID |
| `region` | 'US' \| 'EU' | No | New Relic region (default: 'US') |

### Getting Your Credentials

1. **API Key**: Go to [New Relic API Keys](https://one.newrelic.com/launcher/api-keys-ui.api-keys-launcher) and create a User key
2. **Account ID**: Found in the URL when logged into New Relic (e.g., `https://one.newrelic.com/nr1-core?account=12345`)

## Available Tools

### get_errors
Get APM error events from New Relic.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_errors",
    "arguments": {
      "app_name": "my-app",
      "time_range": "1h",
      "limit": 100
    }
  }
}
```

### run_nrql
Execute a NRQL query against New Relic data.

```json
{
  "method": "tools/call",
  "params": {
    "name": "run_nrql",
    "arguments": {
      "query": "SELECT count(*) FROM Transaction SINCE 1 hour ago FACET appName"
    }
  }
}
```

### get_apm_metrics
Get APM metrics for an application (throughput, response time, error rate).

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_apm_metrics",
    "arguments": {
      "app_name": "my-app",
      "time_range": "1h"
    }
  }
}
```

### get_applications
List APM applications with health status.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_applications",
    "arguments": {
      "filter": "production"
    }
  }
}
```

### get_alerts
Get alert incidents and violations.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_alerts",
    "arguments": {
      "status": "open",
      "priority": "critical",
      "time_range": "24h"
    }
  }
}
```

### get_transactions
Get transaction performance data.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_transactions",
    "arguments": {
      "app_name": "my-app",
      "time_range": "1h",
      "limit": 20
    }
  }
}
```

### get_infrastructure
Get infrastructure host metrics.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_infrastructure",
    "arguments": {
      "host_filter": "prod",
      "time_range": "1h"
    }
  }
}
```

### get_synthetics
Get synthetic monitoring results.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_synthetics",
    "arguments": {
      "monitor_name": "Homepage",
      "status": "FAILED",
      "time_range": "24h"
    }
  }
}
```

### get_service_health
Get health overview of APM applications.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_service_health",
    "arguments": {
      "app_name": "my-app",
      "time_range": "1h"
    }
  }
}
```

## Authentication

This server uses Bearer token authentication. Include the token in requests:

```bash
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

## MCP Protocol

This server implements the Model Context Protocol using StreamableHTTP transport:

- **Endpoint**: `POST /mcp`
- **Protocol**: JSON-RPC 2.0
- **Authentication**: Bearer token

### Standard MCP Methods

| Method | Description |
|--------|-------------|
| `initialize` | Initialize the MCP session |
| `tools/list` | List available tools |
| `tools/call` | Execute a tool |

## Example Requests

### List Tools

```bash
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

### Get Service Health

```bash
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_service_health",
      "arguments": {}
    },
    "id": 2
  }'
```

### Run Custom NRQL Query

```bash
curl -X POST http://localhost:3006/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "run_nrql",
      "arguments": {
        "query": "SELECT average(duration) FROM Transaction SINCE 1 hour ago TIMESERIES"
      }
    },
    "id": 3
  }'
```

## Health Check

The server provides a health check endpoint:

```bash
curl http://localhost:3006/health
```

Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "details": {
    "accountId": "12345",
    "region": "US",
    "connected": true
  }
}
```

## Running the Example

```bash
# Set environment variables
export NEW_RELIC_API_KEY="NRAK-XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
export NEW_RELIC_ACCOUNT_ID="12345"
export NEW_RELIC_REGION="US"
export MCP_AUTH_TOKEN="your-secret-token"

# Run the example server
pnpm example
```

## License

MIT
