# @savvagent/mcp-datadog

Datadog MCP integration for Savvagent. Exposes Datadog APM, metrics, logs, and monitoring data via MCP tools using StreamableHTTP transport with Bearer token authentication.

## Features

- **get_errors**: Fetch APM error traces
- **get_metrics**: Query time-series metrics
- **get_traces**: Fetch APM distributed traces
- **get_logs**: Search and retrieve logs
- **get_monitors**: Get monitor/alert status
- **get_service_health**: Get APM service health overview
- **get_events**: Get events from event stream

## Installation

```bash
npm install @savvagent/mcp-datadog
```

## Quick Start

```typescript
import { DatadogMCPServer } from '@savvagent/mcp-datadog';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const server = new DatadogMCPServer(
  { name: 'datadog-mcp', version: '1.0.0' },
  {
    apiKey: process.env.DD_API_KEY!,
    appKey: process.env.DD_APP_KEY!,
    site: 'datadoghq.com',
    environment: 'production',
    service: 'my-service',
  }
);

await server.initialize();

const app = express();
app.use(express.json());

app.post('/mcp', createHttpHandler(server, {
  auth: { token: process.env.MCP_AUTH_TOKEN! }
}));

app.get('/health', async (req, res) => {
  const health = await server.healthCheck();
  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

app.listen(3000);
```

## Configuration

### DatadogConfig

```typescript
interface DatadogConfig {
  apiKey: string;       // Datadog API key
  appKey: string;       // Datadog Application key
  site?: string;        // Datadog site (default: datadoghq.com)
  environment?: string; // Environment filter
  service?: string;     // Service filter
}
```

### Getting Datadog Credentials

1. **API Key**: Organization Settings → API Keys
2. **Application Key**: Organization Settings → Application Keys
3. **Site**: Your Datadog region (datadoghq.com, datadoghq.eu, us3.datadoghq.com, etc.)

## Available Tools

### get_errors
Fetch APM error traces from Datadog.

| Parameter | Type | Description |
|-----------|------|-------------|
| time_range | string | `15m`, `1h`, `4h`, `1d`, `2d`, `7d` |
| service | string | Service name filter |
| environment | string | Environment filter |
| limit | integer | Max results (1-1000) |

### get_metrics
Query time-series metrics.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Datadog metrics query |
| time_range | string | No | `15m`, `1h`, `4h`, `1d`, `7d` |

### get_traces
Fetch APM distributed traces.

| Parameter | Type | Description |
|-----------|------|-------------|
| service | string | Service name filter |
| operation | string | Operation name filter |
| time_range | string | `15m`, `1h`, `4h`, `1d` |
| min_duration_ms | integer | Minimum duration |
| status | string | `ok` or `error` |
| limit | integer | Max results (1-100) |

### get_logs
Search and retrieve logs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Log search query |
| time_range | string | No | `15m`, `1h`, `4h`, `1d`, `7d` |
| limit | integer | No | Max results (1-1000) |

### get_monitors
Get monitor/alert status.

| Parameter | Type | Description |
|-----------|------|-------------|
| name | string | Filter by name pattern |
| tags | string | Filter by tags (comma-separated) |
| status | string | `Alert`, `Warn`, `No Data`, `OK` |

### get_service_health
Get APM service health overview.

| Parameter | Type | Description |
|-----------|------|-------------|
| service | string | Specific service name |
| environment | string | Environment filter |
| time_range | string | `15m`, `1h`, `4h`, `1d` |

### get_events
Get events from event stream.

| Parameter | Type | Description |
|-----------|------|-------------|
| priority | string | `normal` or `low` |
| sources | string | Comma-separated sources |
| tags | string | Comma-separated tags |
| time_range | string | `1h`, `4h`, `1d`, `7d` |

## Environment Variables

```bash
MCP_AUTH_TOKEN=your-mcp-token
DD_API_KEY=your-api-key
DD_APP_KEY=your-app-key
DD_SITE=datadoghq.com
DD_ENV=production
DD_SERVICE=my-service
PORT=3000
```

## Example Server

```bash
export MCP_AUTH_TOKEN=your-mcp-token
export DD_API_KEY=your-api-key
export DD_APP_KEY=your-app-key

npx ts-node example-server.ts
```

## Testing

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-mcp-token" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_service_health","arguments":{"time_range":"1h"}},"id":1}'
```

## License

MIT
