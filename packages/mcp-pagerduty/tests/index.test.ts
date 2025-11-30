import { PagerDutyMCPServer, PagerDutyConfig } from '../src';

describe('@savvagent/mcp-pagerduty exports', () => {
  it('should export PagerDutyMCPServer', () => {
    expect(PagerDutyMCPServer).toBeDefined();
    expect(typeof PagerDutyMCPServer).toBe('function');
  });

  it('should be able to create an instance of PagerDutyMCPServer', () => {
    const config = {
      name: 'test-server',
      version: '1.0.0',
    };

    const pagerDutyConfig: PagerDutyConfig = {
      apiToken: 'test-token',
    };

    const server = new PagerDutyMCPServer(config, pagerDutyConfig);
    expect(server).toBeInstanceOf(PagerDutyMCPServer);
  });
});
