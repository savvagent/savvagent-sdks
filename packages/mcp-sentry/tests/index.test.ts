/**
 * Unit tests for package exports
 * @jest-environment node
 */

import * as MCPSentry from '../src/index';
import { SentryMCPServer, SentryConfig } from '../src/index';

describe('Package Exports', () => {
  describe('Named exports', () => {
    it('should export SentryMCPServer class', () => {
      expect(MCPSentry.SentryMCPServer).toBeDefined();
      expect(typeof MCPSentry.SentryMCPServer).toBe('function');
    });

    it('SentryMCPServer should be constructible', () => {
      const serverConfig = {
        name: 'test-sentry-server',
        version: '1.0.0',
      };

      const sentryConfig: SentryConfig = {
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
      };

      const server = new SentryMCPServer(serverConfig, sentryConfig);
      expect(server).toBeInstanceOf(SentryMCPServer);
    });
  });

  describe('Module structure', () => {
    it('should have all expected exports', () => {
      const exports = Object.keys(MCPSentry);
      expect(exports).toContain('SentryMCPServer');
    });

    it('should not expose internal implementation details', () => {
      const exports = Object.keys(MCPSentry);
      expect(exports).not.toContain('apiClient');
    });
  });

  describe('TypeScript types', () => {
    it('SentryConfig should have correct shape', () => {
      const validConfig: SentryConfig = {
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
        environment: 'production',
      };

      expect(validConfig).toBeDefined();
      expect(validConfig.authToken).toBe('test-token');
      expect(validConfig.environment).toBe('production');
    });

    it('SentryConfig environment should be optional', () => {
      const configWithoutEnv: SentryConfig = {
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
      };

      expect(configWithoutEnv.environment).toBeUndefined();
    });

    it('SentryConfig apiUrl should be optional', () => {
      const configWithApiUrl: SentryConfig = {
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
        apiUrl: 'https://custom-sentry.io/api/0',
      };

      expect(configWithApiUrl.apiUrl).toBe('https://custom-sentry.io/api/0');
    });
  });

  describe('Server functionality', () => {
    it('should register tools on construction', () => {
      const server = new SentryMCPServer(
        { name: 'test', version: '1.0.0' },
        { authToken: 'x', organization: 'x', project: 'x' }
      );

      const tools = server.getTools();
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('get_errors');
      expect(toolNames).toContain('get_error_details');
      expect(toolNames).toContain('get_error_events');
      expect(toolNames).toContain('search_errors');
      expect(toolNames).toContain('get_service_health');
    });
  });
});
