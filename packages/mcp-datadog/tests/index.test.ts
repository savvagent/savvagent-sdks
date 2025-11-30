/**
 * Tests for mcp-datadog package exports
 */

import { DatadogMCPServer, DatadogConfig } from '../src';

describe('@savvagent/mcp-datadog exports', () => {
  it('should export DatadogMCPServer', () => {
    expect(DatadogMCPServer).toBeDefined();
  });

  it('should be able to instantiate DatadogMCPServer', () => {
    const config: DatadogConfig = {
      apiKey: 'test-key',
      appKey: 'test-app-key',
    };

    const server = new DatadogMCPServer(
      { name: 'test', version: '1.0.0' },
      config
    );

    expect(server).toBeInstanceOf(DatadogMCPServer);
    expect(server.getTools().length).toBeGreaterThan(0);
  });
});
