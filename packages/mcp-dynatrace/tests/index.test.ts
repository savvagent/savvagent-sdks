/**
 * Tests for mcp-dynatrace package exports
 */

import { DynatraceMCPServer, DynatraceConfig } from '../src';

describe('@savvagent/mcp-dynatrace exports', () => {
  it('should export DynatraceMCPServer', () => {
    expect(DynatraceMCPServer).toBeDefined();
  });

  it('should be able to instantiate DynatraceMCPServer', () => {
    const config: DynatraceConfig = {
      environmentUrl: 'https://abc.live.dynatrace.com',
      apiToken: 'test-token',
    };

    const server = new DynatraceMCPServer(
      { name: 'test', version: '1.0.0' },
      config
    );

    expect(server).toBeInstanceOf(DynatraceMCPServer);
    expect(server.getTools().length).toBeGreaterThan(0);
  });
});
