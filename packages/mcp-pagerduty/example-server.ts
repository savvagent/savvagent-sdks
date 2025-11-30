/**
 * Example PagerDuty MCP Server
 *
 * This example demonstrates how to set up a PagerDuty MCP server
 * that exposes incident management tools via JSON-RPC 2.0.
 *
 * Usage:
 *   PAGERDUTY_API_TOKEN=your-token npx ts-node example-server.ts
 */

import express from 'express';
import { PagerDutyMCPServer } from './src';
import { createHttpHandler } from '@savvagent/mcp-sdk';

const app = express();
app.use(express.json());

// Configuration from environment variables
const PAGERDUTY_API_TOKEN = process.env.PAGERDUTY_API_TOKEN || 'your-api-token';
const PAGERDUTY_ROUTING_KEY = process.env.PAGERDUTY_ROUTING_KEY;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || 'your-bearer-token';
const PORT = parseInt(process.env.PORT || '3007', 10);

// Create the PagerDuty MCP server
const mcpServer = new PagerDutyMCPServer(
  {
    name: 'pagerduty-mcp-server',
    version: '1.0.0',
  },
  {
    apiToken: PAGERDUTY_API_TOKEN,
    routingKey: PAGERDUTY_ROUTING_KEY,
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
      console.log(`PagerDuty MCP Server running on port ${PORT}`);
      console.log(`MCP endpoint: POST http://localhost:${PORT}/mcp`);
      console.log(`Health check: GET http://localhost:${PORT}/health`);
      console.log('\nAvailable tools:');
      mcpServer.getTools().forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });
      console.log('\nExample request:');
      console.log(`curl -X POST http://localhost:${PORT}/mcp \\`);
      console.log(`  -H "Content-Type: application/json" \\`);
      console.log(`  -H "Authorization: Bearer ${MCP_AUTH_TOKEN}" \\`);
      console.log(`  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_incidents","arguments":{"status":["triggered","acknowledged"]}},"id":1}'`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
