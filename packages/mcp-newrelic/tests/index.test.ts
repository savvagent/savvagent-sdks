import { NewRelicMCPServer, NewRelicConfig } from '../src';

describe('@savvagent/mcp-newrelic exports', () => {
  it('should export NewRelicMCPServer', () => {
    expect(NewRelicMCPServer).toBeDefined();
    expect(typeof NewRelicMCPServer).toBe('function');
  });

  it('should be able to create an instance of NewRelicMCPServer', () => {
    const config = {
      name: 'test-server',
      version: '1.0.0',
    };

    const newRelicConfig: NewRelicConfig = {
      apiKey: 'test-key',
      accountId: '12345',
    };

    const server = new NewRelicMCPServer(config, newRelicConfig);
    expect(server).toBeInstanceOf(NewRelicMCPServer);
  });
});
