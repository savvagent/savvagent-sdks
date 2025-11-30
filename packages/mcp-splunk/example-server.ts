/**
 * Example Splunk MCP Server
 */

import express from 'express';
import { createHttpHandler } from '@savvagent/mcp-sdk';
import { SplunkMCPServer } from './src/splunk-server';

const CONFIG = {
  port: process.env.PORT || 3000,
  serverName: 'splunk-mcp-server',
  serverVersion: '1.0.0',
  mcpAuthToken: process.env.MCP_AUTH_TOKEN || '',
  splunk: {
    host: process.env.SPLUNK_HOST || '',
    token: process.env.SPLUNK_TOKEN || '',
    defaultIndex: process.env.SPLUNK_INDEX,
    defaultSourcetype: process.env.SPLUNK_SOURCETYPE,
  },
};

async function main() {
  if (!CONFIG.mcpAuthToken) {
    console.error('Missing MCP_AUTH_TOKEN');
    process.exit(1);
  }

  if (!CONFIG.splunk.host || !CONFIG.splunk.token) {
    console.error('Missing SPLUNK_HOST or SPLUNK_TOKEN');
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  const splunkServer = new SplunkMCPServer(
    { name: CONFIG.serverName, version: CONFIG.serverVersion },
    CONFIG.splunk
  );

  await splunkServer.initialize();

  app.post('/mcp', createHttpHandler(splunkServer, {
    auth: { token: CONFIG.mcpAuthToken }
  }));

  app.get('/health', async (req, res) => {
    const health = await splunkServer.healthCheck();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  app.listen(CONFIG.port, () => {
    console.log(`Splunk MCP Server running on port ${CONFIG.port}`);
  });
}

main().catch(console.error);
