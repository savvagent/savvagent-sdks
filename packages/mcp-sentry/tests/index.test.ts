/**
 * Unit tests for package exports
 * @jest-environment node
 */

import * as MCPSentry from '../src/index';
import { SentryMCPServer, SentryConfig } from '../src/index';

describe('Package Exports', () => {
  describe('Named exports', () => {
    test('should export SentryMCPServer class', () => {
      expect(MCPSentry.SentryMCPServer).toBeDefined();
      expect(typeof MCPSentry.SentryMCPServer).toBe('function');
    });

    test('should export SentryConfig type', () => {
      // TypeScript will catch type errors at compile time
      // This test ensures the export is accessible at runtime
      const config: SentryConfig = {
        dsn: 'https://test@sentry.io/123456',
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
      };

      expect(config).toBeDefined();
    });

    test('SentryMCPServer should be constructible', () => {
      const config = {
        organizationId: 'org-123',
        integrationId: 'integration-456',
        serverType: 'sentry',
        config: {
          dsn: 'https://test@sentry.io/123456',
          authToken: 'test-token',
          organization: 'test-org',
          project: 'test-project',
        },
        enabled: true,
      };

      const server = new SentryMCPServer(config);
      expect(server).toBeInstanceOf(SentryMCPServer);
    });
  });

  describe('Module structure', () => {
    test('should have all expected exports', () => {
      const exports = Object.keys(MCPSentry);
      expect(exports).toContain('SentryMCPServer');
    });

    test('should not expose internal implementation details', () => {
      const exports = Object.keys(MCPSentry);
      // Ensure private methods or internal utilities are not exported
      expect(exports).not.toContain('extractFlagTags');
      expect(exports).not.toContain('apiClient');
      expect(exports).not.toContain('sentryClient');
    });
  });

  describe('TypeScript types', () => {
    test('SentryConfig should have correct shape', () => {
      const validConfig: SentryConfig = {
        dsn: 'https://test@sentry.io/123456',
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
        environment: 'production',
      };

      expect(validConfig).toBeDefined();
      expect(validConfig.dsn).toBe('https://test@sentry.io/123456');
      expect(validConfig.environment).toBe('production');
    });

    test('SentryConfig environment should be optional', () => {
      const configWithoutEnv: SentryConfig = {
        dsn: 'https://test@sentry.io/123456',
        authToken: 'test-token',
        organization: 'test-org',
        project: 'test-project',
      };

      expect(configWithoutEnv.environment).toBeUndefined();
    });
  });
});
