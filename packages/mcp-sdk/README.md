# @savvagent/mcp-sdk

Model Context Protocol (MCP) SDK for Savvagent integrations. This is the base framework for building custom MCP servers that integrate Savvagent with observability tools like Sentry, DynaTrace, Splunk, and more.

## What is MCP?

MCP (Model Context Protocol) is Savvagent's integration framework that:
- Receives flag evaluation and error events from Savvagent
- Sends events to external observability tools (Sentry, DynaTrace, etc.)
- Queries error data from external systems
- Correlates errors with flag states for AI-powered detection

## Installation

```bash
npm install @savvagent/mcp-sdk
```

## Quick Start

### Implementing a Custom MCP Server

```typescript
import { MCPServer, FlagEvaluation, FlagError, ErrorQuery, ExternalError } from '@savvagent/mcp-sdk';

class MyCustomMCPServer extends MCPServer {
  private client: any; // Your observability tool client

  async initialize(): Promise<void> {
    // Initialize connection to your observability tool
    this.client = createClient(this.config.config);
    this.initialized = true;
  }

  async onFlagEvaluation(evaluation: FlagEvaluation): Promise<void> {
    // Send flag evaluation as breadcrumb/context
    await this.client.addBreadcrumb({
      category: 'feature-flag',
      message: `Flag ${evaluation.flagKey} evaluated to ${evaluation.result}`,
      data: evaluation,
    });
  }

  async onFlagError(error: FlagError): Promise<void> {
    // Capture error with flag context
    await this.client.captureError({
      message: error.errorMessage,
      tags: {
        flag_key: error.flagKey,
        flag_enabled: error.flagEnabled,
      },
      extra: error.context,
    });
  }

  async queryErrors(query: ErrorQuery): Promise<ExternalError[]> {
    // Query errors from your observability tool
    const errors = await this.client.searchErrors({
      start: query.startTime,
      end: query.endTime,
    });

    return errors.map(e => ({
      id: e.id,
      errorType: e.type,
      errorMessage: e.message,
      timestamp: e.timestamp,
      count: e.count,
      tags: e.tags,
    }));
  }
}
```

### Setting up Webhook Handler

```typescript
import { MCPWebhookHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const app = express();
const webhookHandler = new MCPWebhookHandler();

// Initialize your MCP server
const mcpServer = new MyCustomMCPServer(config);
await mcpServer.initialize();

// Register the server
webhookHandler.registerServer('integration-id', mcpServer);

// Handle webhooks from Savvagent
app.post('/webhook/savvagent', express.json(), async (req, res) => {
  try {
    await webhookHandler.handleWebhook(req.body);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

### Using MCP Client

```typescript
import { MCPClient } from '@savvagent/mcp-sdk';

const client = new MCPClient({
  apiUrl: 'https://api.savvagent.com',
  apiKey: 'your-api-key',
  organizationId: 'your-org-id',
});

// Query evaluations
const evaluations = await client.queryEvaluations({
  organizationId: 'your-org-id',
  flagId: 'flag-id',
  startTime: new Date('2024-01-01'),
  endTime: new Date(),
});

// Send external errors for correlation
await client.sendExternalErrors([
  {
    id: 'sentry-error-1',
    errorType: 'TypeError',
    errorMessage: 'Cannot read property of undefined',
    timestamp: new Date().toISOString(),
    count: 42,
  },
]);
```

## Core Concepts

### MCPServer

Abstract base class for implementing MCP integrations. You must implement:

- `initialize()` - Connect to external service
- `onFlagEvaluation(evaluation)` - Handle flag evaluation events
- `onFlagError(error)` - Handle error events
- `queryErrors(query)` - Query errors from external service

Optional methods to override:
- `correlateErrors()` - Custom correlation logic
- `healthCheck()` - Custom health checks
- `shutdown()` - Cleanup logic

### MCPWebhookHandler

Handles incoming webhooks from Savvagent and routes them to registered MCP servers.

### MCPClient

API client for communicating with Savvagent backend.

## Type Definitions

### FlagEvaluation

```typescript
interface FlagEvaluation {
  id: string;
  organizationId: string;
  flagId: string;
  flagKey: string;
  result: boolean;
  context?: Record<string, any>;
  durationMs?: number;
  traceId?: string;
  timestamp: string;
}
```

### FlagError

```typescript
interface FlagError {
  id: string;
  organizationId: string;
  flagId: string;
  flagKey: string;
  flagEnabled: boolean;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, any>;
  traceId?: string;
  timestamp: string;
}
```

### ExternalError

```typescript
interface ExternalError {
  id: string;
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  timestamp: string;
  count?: number;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
}
```

## Official MCP Integrations

- [@savvagent/mcp-sentry](../mcp-sentry) - Sentry integration
- @savvagent/mcp-dynatrace - DynaTrace integration (coming soon)
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
