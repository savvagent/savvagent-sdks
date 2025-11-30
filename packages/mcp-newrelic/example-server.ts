/**
 * Example New Relic MCP Server
 *
 * This example demonstrates how to set up a New Relic MCP server
 * that exposes APM and monitoring data via JSON-RPC 2.0 tools.
 *
 * Usage:
 *   NEW_RELIC_API_KEY=your-key NEW_RELIC_ACCOUNT_ID=12345 npx ts-node example-server.ts
 */

import express from 'express';
import { NewRelicMCPServer } from './src';
import { createHttpHandler } from '@savvagent/mcp-sdk';

const app = express();
app.use(express.json());

// Configuration from environment variables
const NEW_RELIC_API_KEY = process.env.NEW_RELIC_API_KEY || 'your-api-key';
const NEW_RELIC_ACCOUNT_ID = process.env.NEW_RELIC_ACCOUNT_ID || '12345';
const NEW_RELIC_REGION = (process.env.NEW_RELIC_REGION as 'US' | 'EU') || 'US';
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || 'your-bearer-token';
const PORT = parseInt(process.env.PORT || '3006', 10);

// Create the New Relic MCP server
const mcpServer = new NewRelicMCPServer(
  {
    name: 'newrelic-mcp-server',
    version: '1.0.0',
  },
  {
    apiKey: NEW_RELIC_API_KEY,
    accountId: NEW_RELIC_ACCOUNT_ID,
    region: NEW_RELIC_REGION,
  }
);

// Create HTTP handler with Bearer token authentication
const handler = createHttpHandler(mcpServer, {
  auth: {
    token: MCP_AUTH_TOKEN,
  },
});

// Mount the MCP endpoint using StreamableHTTP transport
app.post('/mcp', handler as express.RequestHandler);

// Health check endpoint (no auth required)
app.get('/health', async (_req, res) => {
  try {
    const health = await mcpServer.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: String(error),
    });
  }
});

// Start the server
async function start() {
  try {
    await mcpServer.initialize();
    app.listen(PORT, () => {
      console.log(`New Relic MCP Server running on port ${PORT}`);
      console.log(`MCP endpoint: POST http://localhost:${PORT}/mcp`);
      console.log(`Health check: GET http://localhost:${PORT}/health`);
      console.log(`Region: ${NEW_RELIC_REGION}`);
      console.log(`Account ID: ${NEW_RELIC_ACCOUNT_ID}`);
      console.log('\nAvailable tools:');
      mcpServer.getTools().forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
      console.log('\nExample request:');
      console.log(`curl -X POST http://localhost:${PORT}/mcp \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \\`);
      console.log(`  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_service_health","arguments":{}},"id":1}'`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
