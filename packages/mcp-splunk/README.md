# @savvagent/mcp-splunk

Splunk MCP integration for Savvagent. Exposes Splunk log analytics via MCP tools using StreamableHTTP transport.

## Features

- **search_logs**: Search logs using SPL queries
- **get_errors**: Fetch error-level logs
- **get_log_patterns**: Get aggregated log patterns
- **get_anomalies**: Detect log anomalies
- **get_saved_searches**: List saved searches
- **run_saved_search**: Execute saved searches
- **get_alerts**: Get triggered alerts
- **get_service_health**: Analyze service health from logs

## Installation

```bash
npm install @savvagent/mcp-splunk
```

## Quick Start

```typescript
import { SplunkMCPServer } from '@savvagent/mcp-splunk';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const server = new SplunkMCPServer(
  { name: 'splunk-mcp', version: '1.0.0' },
  {
    host: process.env.SPLUNK_HOST!,
    token: process.env.SPLUNK_TOKEN!,
    defaultIndex: 'main',
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
interface SplunkConfig {
  host: string;              // Splunk host URL
  token: string;             // Auth token
  defaultIndex?: string;     // Default index
  defaultSourcetype?: string; // Default sourcetype
}
```

## Environment Variables

```bash
MCP_AUTH_TOKEN=your-mcp-token
SPLUNK_HOST=https://splunk.example.com:8089
SPLUNK_TOKEN=your-splunk-token
SPLUNK_INDEX=main
```

## License

MIT
