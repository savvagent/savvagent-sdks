# @savvagent/mcp-sentry

Sentry MCP integration for Savvagent. Connect your feature flags with Sentry error tracking for AI-powered error correlation.

## Features

- 🔍 **Flag Breadcrumbs**: Every flag evaluation is recorded as a breadcrumb in Sentry
- 🐛 **Error Tagging**: Errors are automatically tagged with flag context
- 📊 **Error Correlation**: Query Sentry errors for correlation analysis
- 🔗 **Distributed Tracing**: Links flag evaluations with Sentry traces
- 🏥 **Health Checks**: Monitor Sentry connection status

## Installation

```bash
npm install @savvagent/mcp-sentry
```

## Quick Start

### 1. Setup Sentry MCP Server

```typescript
import { SentryMCPServer } from '@savvagent/mcp-sentry';

const server = new SentryMCPServer({
  organizationId: 'your-org-id',
  integrationId: 'your-integration-id',
  serverType: 'sentry',
  config: {
    dsn: 'https://xxx@sentry.io/xxx',
    authToken: 'your-sentry-auth-token',
    organization: 'your-sentry-org',
    project: 'your-sentry-project',
    environment: 'production',
  },
  enabled: true,
});

await server.initialize();
```

### 2. Handle Flag Events

```typescript
import { MCPWebhookHandler } from '@savvagent/mcp-sdk';
import express from 'express';

const app = express();
const webhookHandler = new MCPWebhookHandler();

// Register Sentry MCP server
webhookHandler.registerServer('sentry-integration-id', server);

// Webhook endpoint for Savvagent
app.post('/webhook/savvagent', express.json(), async (req, res) => {
  try {
    await webhookHandler.handleWebhook(req.body);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('Sentry MCP server listening on port 3000');
});
```

### 3. Query Errors for Correlation

```typescript
// Query recent errors from Sentry
const errors = await server.queryErrors({
  organizationId: 'your-org-id',
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
  endTime: new Date(),
  limit: 100,
});

console.log(`Found ${errors.length} errors in Sentry`);

// Correlate errors with flag evaluations
const evaluations = await savvagentClient.queryEvaluations({
  organizationId: 'your-org-id',
  startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endTime: new Date(),
});

const correlations = await server.correlateErrors(errors, evaluations);
console.log(`Found ${correlations.length} potential flag-error correlations`);
```

## Configuration

### SentryConfig

```typescript
interface SentryConfig {
  dsn: string;              // Sentry DSN
  authToken: string;        // Sentry API auth token
  organization: string;     // Sentry organization slug
  project: string;          // Sentry project slug
  environment?: string;     // Environment (default: 'production')
}
```

### Getting Sentry Credentials

1. **DSN**: Found in Sentry project settings → Client Keys (DSN)
2. **Auth Token**: Create in Sentry → Settings → Auth Tokens
   - Required scopes: `project:read`, `event:read`, `org:read`
3. **Organization**: Your Sentry organization slug (in URL)
4. **Project**: Your Sentry project slug (in URL)

## How It Works

### Flag Evaluations → Sentry Breadcrumbs

When a feature flag is evaluated:

```typescript
// Savvagent SDK evaluates flag
const enabled = await client.isEnabled('new-checkout');

// ↓ Event sent to Savvagent backend
// ↓ Webhook triggers Sentry MCP server
// ↓ Breadcrumb added to Sentry

// In Sentry, you'll see:
// 🍞 feature-flag: Flag "new-checkout" evaluated to true
```

### Errors → Sentry with Flag Context

When an error occurs in flagged code:

```typescript
await client.withFlag('new-checkout', async () => {
  throw new Error('Payment processing failed');
});

// ↓ Error sent to Savvagent
// ↓ Webhook triggers Sentry MCP server
// ↓ Error captured in Sentry with tags:
//   - flag_key: "new-checkout"
//   - flag_enabled: "true"
```

### Error Correlation

Savvagent queries Sentry for errors and correlates them with flag states:

```typescript
// 1. Query errors from Sentry
const sentryErrors = await server.queryErrors({ ... });

// 2. Get flag evaluations from Savvagent
const evaluations = await savvagentClient.queryEvaluations({ ... });

// 3. Correlate using time proximity and flag context
const correlations = await server.correlateErrors(sentryErrors, evaluations);

// 4. AI analyzes correlations to detect causation
```

## Examples

### Express.js Server

```typescript
import express from 'express';
import { SentryMCPServer } from '@savvagent/mcp-sentry';
import { MCPWebhookHandler } from '@savvagent/mcp-sdk';

const app = express();
const webhookHandler = new MCPWebhookHandler();

// Initialize Sentry MCP
const sentryServer = new SentryMCPServer({
  organizationId: process.env.ORG_ID!,
  integrationId: process.env.INTEGRATION_ID!,
  serverType: 'sentry',
  config: {
    dsn: process.env.SENTRY_DSN!,
    authToken: process.env.SENTRY_AUTH_TOKEN!,
    organization: process.env.SENTRY_ORG!,
    project: process.env.SENTRY_PROJECT!,
  },
  enabled: true,
});

await sentryServer.initialize();
webhookHandler.registerServer(process.env.INTEGRATION_ID!, sentryServer);

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = await sentryServer.healthCheck();
  res.status(health.healthy ? 200 : 503).json(health);
});

// Webhook endpoint
app.post('/webhook/savvagent', express.json(), async (req, res) => {
  try {
    await webhookHandler.handleWebhook(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

### Standalone Script

```typescript
import { SentryMCPServer } from '@savvagent/mcp-sentry';

async function main() {
  const server = new SentryMCPServer({
    organizationId: 'org-123',
    integrationId: 'int-456',
    serverType: 'sentry',
    config: {
      dsn: 'https://xxx@sentry.io/xxx',
      authToken: 'token',
      organization: 'my-org',
      project: 'my-project',
    },
    enabled: true,
  });

  await server.initialize();

  // Query errors
  const errors = await server.queryErrors({
    organizationId: 'org-123',
    startTime: new Date(Date.now() - 3600000),
    endTime: new Date(),
    limit: 50,
  });

  console.log(`Found ${errors.length} errors`);

  await server.shutdown();
}

main();
```

## API Reference

### SentryMCPServer

Extends `MCPServer` from `@savvagent/mcp-sdk`.

#### Methods

- `initialize()` - Initialize Sentry client and API client
- `onFlagEvaluation(evaluation)` - Handle flag evaluation (adds breadcrumb)
- `onFlagError(error)` - Handle error (captures in Sentry)
- `queryErrors(query)` - Query errors from Sentry
- `correlateErrors(errors, evaluations)` - Correlate errors with flags
- `healthCheck()` - Check Sentry connection health
- `shutdown()` - Close connections and cleanup

## Environment Variables

```bash
# Sentry Configuration
SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
SENTRY_ENVIRONMENT=production

# Savvagent Configuration
SAVVAGENT_ORG_ID=your-org-id
SAVVAGENT_INTEGRATION_ID=your-integration-id
```

## Troubleshooting

### Breadcrumbs not appearing in Sentry

- Ensure Sentry DSN is correct
- Check that `onFlagEvaluation` is being called
- Verify Sentry environment matches your filter

### API queries failing

- Verify auth token has correct scopes (`project:read`, `event:read`, `org:read`)
- Check organization and project slugs
- Ensure API rate limits aren't exceeded

### Webhook errors

- Verify webhook URL is accessible from Savvagent
- Check webhook signature validation
- Review server logs for detailed errors

## Development

```bash
# Install dependencies
npm install

# Link local mcp-sdk for development
npm link ../mcp-sdk

# Build
npm run build

# Watch mode
npm run dev

# Test
npm test

# Lint
npm run lint
```

## License

MIT

## Support

- Documentation: [savvagent.com/docs/integrations/sentry](https://savvagent.com/docs/integrations/sentry)
- Issues: [GitHub Issues](https://github.com/yourusername/savvagent/issues)
- Email: support@savvagent.com
