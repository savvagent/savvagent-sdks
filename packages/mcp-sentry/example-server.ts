/**
 * Example Sentry MCP Server
 *
 * This example shows how to set up a Sentry MCP server that Savvagent
 * can query for error data using StreamableHTTP transport with Bearer token auth.
 *
 * Usage:
 *   npm install express
 *   MCP_AUTH_TOKEN=xxx SENTRY_AUTH_TOKEN=xxx SENTRY_ORG=xxx SENTRY_PROJECT=xxx ts-node example-server.ts
 *
 * Test with curl:
 *   # List available tools (with Bearer token)
 *   curl -X POST http://localhost:3000/mcp \
 *     -H "Content-Type: application/json" \
 *     -H "Authorization: Bearer your-secret-token" \
 *     -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
 *
 *   # Get recent errors
 *   curl -X POST http://localhost:3000/mcp \
 *     -H "Content-Type: application/json" \
 *     -H "Authorization: Bearer your-secret-token" \
 *     -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_errors","arguments":{"time_range":"24h"}},"id":2}'
 */

import express from 'express';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import { SentryMCPServer } from './src/sentry-server';

// Configuration from environment variables
const CONFIG = {
  port: process.env.PORT || 3000,

  // MCP Server config
  serverName: 'sentry-mcp-server',
  serverVersion: '1.0.0',

  // MCP authentication token (for Savvagent to authenticate with this server)
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',

  // Sentry configuration
  sentry: {
    authToken: process.env.SENTRY_AUTH_TOKEN || '',
    organization: process.env.SENTRY_ORG || '',
    project: process.env.SENTRY_PROJECT || '',
    environment: process.env.SENTRY_ENVIRONMENT,
  },
};

async function main() {
  // Validate required config
  if (!CONFIG.mcpAuthToken) {
    console.error('Missing required environment variable:');
    console.error('  MCP_AUTH_TOKEN - Bearer token for MCP authentication');
    process.exit(1);
  }

  if (!CONFIG.sentry.authToken || !CONFIG.sentry.organization || !CONFIG.sentry.project) {
    console.error('Missing required Sentry environment variables:');
    console.error('  SENTRY_AUTH_TOKEN - Sentry API authentication token');
    console.error('  SENTRY_ORG        - Sentry organization slug');
    console.error('  SENTRY_PROJECT    - Sentry project slug');
    process.exit(1);
  }

  console.log('Starting Sentry MCP Server...');

  const app = express();
  app.use(express.json());

  // Initialize Sentry MCP Server
  const sentryServer = new SentryMCPServer(
    {
      name: CONFIG.serverName,
      version: CONFIG.serverVersion,
    },
    CONFIG.sentry
  );

  try {
    await sentryServer.initialize();
    console.log('Sentry MCP Server initialized');
  } catch (error) {
    console.error('Failed to initialize Sentry MCP Server:', error);
    process.exit(1);
  }

  // MCP JSON-RPC endpoint with Bearer token authentication (StreamableHTTP)
  app.post('/mcp', createHttpHandler(sentryServer, {
    auth: { token: CONFIG.mcpAuthToken }
  }));

  // Health check endpoint (no auth required)
  app.get('/health', async (req, res) => {
    const health = await sentryServer.healthCheck();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  // Server info endpoint (no auth required)
  app.get('/', (req, res) => {
    res.json({
      name: CONFIG.serverName,
      version: CONFIG.serverVersion,
      protocol: 'MCP StreamableHTTP + JSON-RPC 2.0',
      tools: sentryServer.getTools().map((t) => t.name),
      endpoints: {
        mcp: 'POST /mcp',
        health: 'GET /health',
      },
      config: {
        organization: CONFIG.sentry.organization,
        project: CONFIG.sentry.project,
        environment: CONFIG.sentry.environment || 'all',
      },
    });
  });

  // Start server
  app.listen(CONFIG.port, () => {
    console.log(`\nSentry MCP Server running on port ${CONFIG.port}`);
    console.log(`\nConfiguration:`);
    console.log(`  Organization: ${CONFIG.sentry.organization}`);
    console.log(`  Project:      ${CONFIG.sentry.project}`);
    console.log(`  Environment:  ${CONFIG.sentry.environment || 'all'}`);
    console.log(`\nAvailable Tools:`);
    sentryServer.getTools().forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log(`\nEndpoints:`);
    console.log(`  MCP:    http://localhost:${CONFIG.port}/mcp`);
    console.log(`  Health: http://localhost:${CONFIG.port}/health`);
    console.log(`\nTest with:`);
    console.log(`  curl -X POST http://localhost:${CONFIG.port}/mcp \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -H "Authorization: Bearer YOUR_MCP_AUTH_TOKEN" \\`);
    console.log(`    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await sentryServer.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await sentryServer.shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
