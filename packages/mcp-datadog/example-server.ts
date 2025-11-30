/**
 * Example Datadog MCP Server
 *
 * This example shows how to set up a Datadog MCP server that Savvagent
 * can query for APM, metrics, and monitoring data using StreamableHTTP transport.
 *
 * Usage:
 *   npm install express
 *   MCP_AUTH_TOKEN=xxx DD_API_KEY=xxx DD_APP_KEY=xxx ts-node example-server.ts
 *
 * Test with curl:
 *   curl -X POST http://localhost:3000/mcp \
 *     -H "Content-Type: application/json" \
 *     -H "Authorization: Bearer your-mcp-token" \
 *     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
 */

import express from 'express';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import { DatadogMCPServer } from './src/datadog-server';

const CONFIG = {
  port: process.env.PORT || 3000,
  serverName: 'datadog-mcp-server',
  serverVersion: '1.0.0',
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',
  datadog: {
    apiKey: process.env.DD_API_KEY || '',
    appKey: process.env.DD_APP_KEY || '',
    site: process.env.DD_SITE || 'datadoghq.com',
    environment: process.env.DD_ENV,
    service: process.env.DD_SERVICE,
  },
};

async function main() {
  if (!CONFIG.mcpAuthToken) {
    console.error('Missing MCP_AUTH_TOKEN environment variable');
    process.exit(1);
  }

  if (!CONFIG.datadog.apiKey || !CONFIG.datadog.appKey) {
    console.error('Missing required Datadog environment variables:');
    console.error('  DD_API_KEY  - Datadog API key');
    console.error('  DD_APP_KEY  - Datadog Application key');
    process.exit(1);
  }

  console.log('Starting Datadog MCP Server...');

  const app = express();
  app.use(express.json());

  const datadogServer = new DatadogMCPServer(
    { name: CONFIG.serverName, version: CONFIG.serverVersion },
    CONFIG.datadog
  );

  try {
    await datadogServer.initialize();
    console.log('Datadog MCP Server initialized');
  } catch (error) {
    console.error('Failed to initialize Datadog MCP Server:', error);
    process.exit(1);
  }

  app.post('/mcp', createHttpHandler(datadogServer, {
    auth: { token: CONFIG.mcpAuthToken }
  }));

  app.get('/health', async (req, res) => {
    const health = await datadogServer.healthCheck();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  app.get('/', (req, res) => {
    res.json({
      name: CONFIG.serverName,
      version: CONFIG.serverVersion,
      protocol: 'MCP StreamableHTTP + JSON-RPC 2.0',
      tools: datadogServer.getTools().map((t) => t.name),
      endpoints: { mcp: 'POST /mcp', health: 'GET /health' },
    });
  });

  app.listen(CONFIG.port, () => {
    console.log(`\nDatadog MCP Server running on port ${CONFIG.port}`);
    console.log(`\nAvailable Tools:`);
    datadogServer.getTools().forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log(`\nTest with:`);
    console.log(`  curl -X POST http://localhost:${CONFIG.port}/mcp \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -H "Authorization: Bearer YOUR_MCP_AUTH_TOKEN" \\`);
    console.log(`    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`);
  });

  process.on('SIGTERM', async () => {
    await datadogServer.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await datadogServer.shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
