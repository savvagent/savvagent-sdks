/**
 * Example Sentry MCP Integration Server
 *
 * This example shows how to set up a complete Sentry MCP integration server
 * that receives events from Savvagent and forwards them to Sentry.
 *
 * Usage:
 *   npm install express
 *   ts-node example-server.ts
 */

import express from 'express';
import { SentryMCPServer } from './src/sentry-server';
import { MCPWebhookHandler } from '@savvagent/mcp-sdk';

// Configuration
const CONFIG = {
  port: process.env.PORT || 3000,
  savvagentApiUrl: process.env.SAVVAGENT_API_URL || 'http://localhost:8080',

  // Organization and integration IDs (from Savvagent)
  organizationId: process.env.ORG_ID || 'your-org-id',
  integrationId: process.env.INTEGRATION_ID || 'your-integration-id',

  // Sentry configuration
  sentry: {
    dsn: process.env.SENTRY_DSN || 'https://xxx@sentry.io/xxx',
    authToken: process.env.SENTRY_AUTH_TOKEN || 'your-auth-token',
    organization: process.env.SENTRY_ORG || 'your-org-slug',
    project: process.env.SENTRY_PROJECT || 'your-project-slug',
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
  },
};

async function main() {
  console.log('🚀 Starting Sentry MCP Integration Server...');

  const app = express();
  app.use(express.json());

  // Initialize Sentry MCP Server
  const sentryServer = new SentryMCPServer({
    organizationId: CONFIG.organizationId,
    integrationId: CONFIG.integrationId,
    serverType: 'sentry',
    config: CONFIG.sentry,
    enabled: true,
  });

  try {
    await sentryServer.initialize();
    console.log('✅ Sentry MCP Server initialized');
  } catch (error) {
    console.error('❌ Failed to initialize Sentry MCP Server:', error);
    process.exit(1);
  }

  // Initialize webhook handler
  const webhookHandler = new MCPWebhookHandler();
  webhookHandler.registerServer(CONFIG.integrationId, sentryServer);
  console.log('✅ Webhook handler registered');

  // Health check endpoint
  app.get('/health', async (req, res) => {
    const health = await sentryServer.healthCheck();
    res.status(health.healthy ? 200 : 503).json({
      status: health.healthy ? 'healthy' : 'unhealthy',
      message: health.message,
      timestamp: health.lastCheck,
      integration: {
        organizationId: CONFIG.organizationId,
        integrationId: CONFIG.integrationId,
      },
    });
  });

  // Webhook endpoint for Savvagent events
  app.post('/webhook/savvagent', async (req, res) => {
    try {
      console.log(`📥 Received webhook: ${req.body.eventType}`);
      await webhookHandler.handleWebhook(req.body);
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('❌ Webhook error:', error.message);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Query errors endpoint (for testing)
  app.get('/api/errors', async (req, res) => {
    try {
      const errors = await sentryServer.queryErrors({
        organizationId: CONFIG.organizationId,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        endTime: new Date(),
        limit: 50,
      });

      res.json({
        count: errors.length,
        errors: errors.map(e => ({
          id: e.id,
          type: e.errorType,
          message: e.errorMessage,
          timestamp: e.timestamp,
          count: e.count,
        })),
      });
    } catch (error: any) {
      console.error('❌ Error querying Sentry:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Savvagent Sentry MCP Integration Server',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: 'GET /health',
        webhook: 'POST /webhook/savvagent',
        errors: 'GET /api/errors',
      },
      config: {
        organization: CONFIG.organizationId,
        integration: CONFIG.integrationId,
        sentryOrg: CONFIG.sentry.organization,
        sentryProject: CONFIG.sentry.project,
      },
    });
  });

  // Start server
  app.listen(CONFIG.port, () => {
    console.log(`\n✨ Sentry MCP Server running on port ${CONFIG.port}`);
    console.log(`\n📝 Configuration:`);
    console.log(`   Organization ID: ${CONFIG.organizationId}`);
    console.log(`   Integration ID:  ${CONFIG.integrationId}`);
    console.log(`   Sentry Org:      ${CONFIG.sentry.organization}`);
    console.log(`   Sentry Project:  ${CONFIG.sentry.project}`);
    console.log(`\n🔗 Endpoints:`);
    console.log(`   Health:   http://localhost:${CONFIG.port}/health`);
    console.log(`   Webhook:  http://localhost:${CONFIG.port}/webhook/savvagent`);
    console.log(`   Errors:   http://localhost:${CONFIG.port}/api/errors`);
    console.log(`\n📚 Documentation: https://savvagent.com/docs/integrations/sentry`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await sentryServer.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await sentryServer.shutdown();
    process.exit(0);
  });
}

// Run the server
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
