/**
 * Tests for mcp-splunk package exports
 */

import { SplunkMCPServer, SplunkConfig } from '../src';

describe('@savvagent/mcp-splunk exports', () => {
  it('should export SplunkMCPServer', () => {
    expect(SplunkMCPServer).toBeDefined();
  });

  it('should be able to instantiate SplunkMCPServer', () => {
    const config: SplunkConfig = {
      host: 'https://splunk.example.com:8089',
      token: 'test-token',
    };

    const server = new SplunkMCPServer(
      { name: 'test', version: '1.0.0' },
      config
    );

    expect(server).toBeInstanceOf(SplunkMCPServer);
    expect(server.getTools().length).toBeGreaterThan(0);
  });
});
