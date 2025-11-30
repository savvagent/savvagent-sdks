# @savvagent/mcp-dynatrace

Dynatrace MCP integration for Savvagent. Exposes Dynatrace APM and monitoring data via MCP tools.

## Features

- **get_problems**: Get active problems/incidents
- **get_problem_details**: Get detailed problem information
- **get_services**: List monitored services
- **get_service_metrics**: Get service metrics
- **get_hosts**: List monitored hosts
- **get_logs**: Query logs
- **get_synthetic_monitors**: Get synthetic monitor status
- **get_service_health**: Get overall service health
- **get_events**: Get events

## Installation

```bash
npm install @savvagent/mcp-dynatrace
```

## Quick Start

```typescript
import { DynatraceMCPServer } from '@savvagent/mcp-dynatrace';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const server = new DynatraceMCPServer(
  { name: 'dynatrace-mcp', version: '1.0.0' },
  {
    environmentUrl: process.env.DT_ENV_URL!,
    apiToken: process.env.DT_API_TOKEN!,
    managementZone: 'production',
  }
);

await server.initialize();

const app = express();
app.use(express.json());

app.post('/mcp', createHttpHandler(server, {
  auth: { token: process.env.MCP_AUTH_TOKEN! }
}));

app.listen(3000);
```

## Configuration

```typescript
interface DynatraceConfig {
  environmentUrl: string;    // Dynatrace environment URL
  apiToken: string;          // API token
  managementZone?: string;   // Default management zone
}
```

## Environment Variables

```bash
MCP_AUTH_TOKEN=your-mcp-token
DT_ENV_URL=https://abc12345.live.dynatrace.com
DT_API_TOKEN=your-dynatrace-token
DT_MANAGEMENT_ZONE=production
```

## License

MIT
