/**
 * Example Dynatrace MCP Server
 */

import express from 'express';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import { DynatraceMCPServer } from './src/dynatrace-server';

const CONFIG = {
  port: process.env.PORT || 3000,
  serverName: 'dynatrace-mcp-server',
  serverVersion: '1.0.0',
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',
  dynatrace: {
    environmentUrl: process.env.DT_ENV_URL || '',
    apiToken: process.env.DT_API_TOKEN || '',
    managementZone: process.env.DT_MANAGEMENT_ZONE,
  },
};

async function main() {
  if (!CONFIG.mcpAuthToken) {
    console.error('Missing MCP_AUTH_TOKEN');
    process.exit(1);
  }

  if (!CONFIG.dynatrace.environmentUrl || !CONFIG.dynatrace.apiToken) {
    console.error('Missing DT_ENV_URL or DT_API_TOKEN');
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  const dynatraceServer = new DynatraceMCPServer(
    { name: CONFIG.serverName, version: CONFIG.serverVersion },
    CONFIG.dynatrace
  );

  await dynatraceServer.initialize();

  app.post('/mcp', createHttpHandler(dynatraceServer, {
    auth: { token: CONFIG.mcpAuthToken }
  }));

  app.get('/health', async (req, res) => {
    const health = await dynatraceServer.healthCheck();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  app.listen(CONFIG.port, () => {
    console.log(`Dynatrace MCP Server running on port ${CONFIG.port}`);
  });
}

main().catch(console.error);
