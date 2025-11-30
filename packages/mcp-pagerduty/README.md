# @savvagent/mcp-pagerduty

PagerDuty MCP integration for Savvagent - Connect feature flags with PagerDuty incident management.

## Installation

```bash
npm install @savvagent/mcp-pagerduty
# or
pnpm add @savvagent/mcp-pagerduty
```

## Quick Start

```typescript
import express from 'express';
import { PagerDutyMCPServer } from '@savvagent/mcp-pagerduty';
import { createHttpHandler } from '@savvagent/mcp-sdk';

const app = express();
app.use(express.json());

const mcpServer = new PagerDutyMCPServer(
  {
    name: 'my-pagerduty-server',
    version: '1.0.0',
  },
  {
    apiToken: process.env.PAGERDUTY_API_TOKEN!,
  }
);

// Create handler with Bearer token authentication
const handler = createHttpHandler(mcpServer, {
  auth: { token: process.env.MCP_AUTH_TOKEN! },
});

// Mount on /mcp endpoint (StreamableHTTP transport)
app.post('/mcp', handler);

await mcpServer.initialize();
app.listen(3007);
```

## Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `apiToken` | string | Yes | PagerDuty REST API v2 token |
| `routingKey` | string | No | Events API integration key (for sending events) |

### Getting Your API Token

1. Go to PagerDuty > **Integrations** > **API Access Keys**
2. Click **Create New API Key**
3. Give it a description and select **Read/Write** access
4. Copy the generated token

## Available Tools

### get_incidents
Get PagerDuty incidents with filtering options.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_incidents",
    "arguments": {
      "status": ["triggered", "acknowledged"],
      "urgency": "high",
      "limit": 25
    }
  }
}
```

### get_incident_details
Get detailed information about a specific incident including timeline.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_incident_details",
    "arguments": {
      "incident_id": "P123ABC"
    }
  }
}
```

### get_services
List PagerDuty services.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_services",
    "arguments": {
      "query": "production",
      "include": ["escalation_policies", "teams"]
    }
  }
}
```

### get_on_call
Get current on-call users.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_on_call",
    "arguments": {
      "escalation_policy_ids": ["POLICY123"]
    }
  }
}
```

### get_schedules
List PagerDuty schedules.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_schedules",
    "arguments": {
      "query": "primary"
    }
  }
}
```

### get_escalation_policies
List escalation policies.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_escalation_policies",
    "arguments": {}
  }
}
```

### get_users
List PagerDuty users.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_users",
    "arguments": {
      "query": "john",
      "include": ["contact_methods", "teams"]
    }
  }
}
```

### get_analytics
Get incident analytics and metrics.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_analytics",
    "arguments": {
      "since": "2024-01-01T00:00:00Z",
      "until": "2024-01-31T23:59:59Z"
    }
  }
}
```

### create_incident
Create a new PagerDuty incident.

```json
{
  "method": "tools/call",
  "params": {
    "name": "create_incident",
    "arguments": {
      "title": "Database connection failure",
      "service_id": "SERVICE123",
      "urgency": "high",
      "body": "Multiple connection timeouts detected"
    }
  }
}
```

### update_incident
Update an incident (acknowledge, resolve).

```json
{
  "method": "tools/call",
  "params": {
    "name": "update_incident",
    "arguments": {
      "incident_id": "P123ABC",
      "status": "resolved",
      "resolution": "Fixed by restarting the service"
    }
  }
}
```

### get_alerts
Get alerts associated with an incident.

```json
{
  "method": "tools/call",
  "params": {
    "name": "get_alerts",
    "arguments": {
      "incident_id": "P123ABC"
    }
  }
}
```

## Authentication

This server uses Bearer token authentication. Include the token in requests:

```bash
curl -X POST http://localhost:3007/mcp \
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

### List Active Incidents

```bash
curl -X POST http://localhost:3007/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_incidents",
      "arguments": {
        "status": ["triggered", "acknowledged"]
      }
    },
    "id": 1
  }'
```

### Get On-Call Schedule

```bash
curl -X POST http://localhost:3007/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_on_call",
      "arguments": {}
    },
    "id": 2
  }'
```

### Create New Incident

```bash
curl -X POST http://localhost:3007/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "create_incident",
      "arguments": {
        "title": "Production API is down",
        "service_id": "SERVICE123",
        "urgency": "high"
      }
    },
    "id": 3
  }'
```

## Health Check

The server provides a health check endpoint:

```bash
curl http://localhost:3007/health
```

Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "details": {
    "connected": true
  }
}
```

## Running the Example

```bash
# Set environment variables
export PAGERDUTY_API_TOKEN="your-pagerduty-api-token"
export MCP_AUTH_TOKEN="your-secret-token"

# Run the example server
pnpm example
```

## License

MIT
