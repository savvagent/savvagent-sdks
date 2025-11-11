/**
 * Example usage of Vexil SDK
 * Run with: npx tsx example.ts
 */

import { FlagClient } from './src';

async function main() {
  console.log('🚀 Vexil SDK Example\n');

  // Initialize the client
  const client = new FlagClient({
    apiKey: 'sdk_dev_example_key',
    baseUrl: 'http://localhost:8080',
    enableRealtime: true,
    enableTelemetry: true,
    defaults: {
      'example-flag': false,
    },
  });

  console.log('✅ Client initialized');
  console.log(`📡 Real-time connected: ${client.isRealtimeConnected()}\n`);

  // Example 1: Simple flag check
  console.log('Example 1: Simple flag check');
  const isEnabled = await client.isEnabled('new-ui');
  console.log(`  new-ui enabled: ${isEnabled}\n`);

  // Example 2: Flag with context
  console.log('Example 2: Flag with user context');
  const userContext = {
    userId: 'user-123',
    attributes: {
      plan: 'premium',
      region: 'us-east',
    },
  };
  const isPremiumEnabled = await client.isEnabled('premium-feature', userContext);
  console.log(`  premium-feature enabled: ${isPremiumEnabled}\n`);

  // Example 3: Detailed evaluation
  console.log('Example 3: Detailed evaluation');
  const result = await client.evaluate('experimental-feature');
  console.log(`  Result:`, JSON.stringify(result, null, 2), '\n');

  // Example 4: Conditional execution with error tracking
  console.log('Example 4: Conditional execution');
  const output = await client.withFlag('new-algorithm', async () => {
    console.log('  → Executing flagged code...');
    return 'Success!';
  });
  console.log(`  Output: ${output}\n`);

  // Example 5: Subscribe to flag updates
  console.log('Example 5: Subscribe to updates');
  const unsubscribe = client.subscribe('new-ui', () => {
    console.log('  🔔 Flag "new-ui" was updated!');
  });

  // Example 6: Cache management
  console.log('Example 6: Cache management');
  const cachedFlags = client.getCachedFlags();
  console.log(`  Cached flags: ${cachedFlags.join(', ')}\n`);

  // Wait a bit to demonstrate real-time updates
  console.log('Waiting 5 seconds for real-time updates...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Cleanup
  unsubscribe();
  client.close();
  console.log('\n✅ Client closed');
}

main().catch(console.error);
