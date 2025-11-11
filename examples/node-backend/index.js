import express from 'express';
import { SavvagentClient } from '@savvagent/sdk';

const app = express();
const port = process.env.PORT || 3000;

// Initialize Savvagent client
const savvagent = new SavvagentClient({
  apiUrl: process.env.SAVVAGENT_API_URL || 'http://localhost:8080',
  sdkKey: process.env.SAVVAGENT_SDK_KEY || 'your-sdk-key',
  environment: 'development',
  cache: {
    enabled: true,
    ttl: 60000, // 1 minute
  },
});

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Example endpoint using feature flag
app.get('/api/features/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // Check multiple feature flags
    const [newUIEnabled, betaFeaturesEnabled, advancedAnalytics] = await Promise.all([
      savvagent.isEnabled('new-ui', {
        userId,
        attributes: {
          userAgent: req.headers['user-agent'],
        },
      }),
      savvagent.isEnabled('beta-features', { userId }),
      savvagent.isEnabled('advanced-analytics', { userId }),
    ]);

    res.json({
      userId,
      features: {
        newUI: newUIEnabled,
        betaFeatures: betaFeaturesEnabled,
        advancedAnalytics,
      },
    });
  } catch (error) {
    console.error('Error checking feature flags:', error);
    res.status(500).json({ error: 'Failed to check feature flags' });
  }
});

// Example endpoint with feature-gated functionality
app.post('/api/data', async (req, res) => {
  try {
    const userId = req.body.userId || 'anonymous';

    // Check if advanced processing is enabled
    const advancedProcessing = await savvagent.isEnabled('advanced-processing', {
      userId,
      attributes: {
        endpoint: '/api/data',
      },
    });

    let result;
    if (advancedProcessing) {
      // Do advanced processing
      result = {
        processed: true,
        method: 'advanced',
        data: req.body,
      };
    } else {
      // Do basic processing
      result = {
        processed: true,
        method: 'basic',
        data: req.body,
      };
    }

    res.json(result);
  } catch (error) {
    console.error('Error processing data:', error);
    res.status(500).json({ error: 'Failed to process data' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Savvagent API URL: ${savvagent.config.apiUrl}`);
});
