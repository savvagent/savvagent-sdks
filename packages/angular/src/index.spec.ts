/**
 * Integration tests for package exports
 */

import * as AngularSDK from './index';

describe('Package Exports', () => {
  describe('Module Exports', () => {
    it('should export SavvagentModule', () => {
      expect(AngularSDK.SavvagentModule).toBeDefined();
      expect(typeof AngularSDK.SavvagentModule).toBe('function');
    });
  });

  describe('Service Exports', () => {
    it('should export SavvagentService', () => {
      expect(AngularSDK.SavvagentService).toBeDefined();
      expect(typeof AngularSDK.SavvagentService).toBe('function');
    });

    it('should export SAVVAGENT_CONFIG injection token', () => {
      expect(AngularSDK.SAVVAGENT_CONFIG).toBeDefined();
    });
  });

  describe('Type Exports', () => {
    it('should have correct type structure for SavvagentConfig', () => {
      const config: AngularSDK.SavvagentConfig = {
        config: {
          apiKey: 'test',
        },
        defaultContext: {
          applicationId: 'test-app',
        },
      };
      expect(config).toBeDefined();
    });

    it('should have correct type structure for DefaultFlagContext', () => {
      const context: AngularSDK.DefaultFlagContext = {
        applicationId: 'app',
        environment: 'production',
        userId: 'user-123',
        attributes: { plan: 'pro' },
      };
      expect(context).toBeDefined();
    });

    it('should have correct type structure for FlagObservableResult', () => {
      const result: AngularSDK.FlagObservableResult = {
        value: true,
        loading: false,
        error: null,
        result: {
          key: 'test-flag',
          value: true,
          reason: 'evaluated',
        },
      };
      expect(result).toBeDefined();
    });

    it('should have correct type structure for FlagOptions', () => {
      const options: AngularSDK.FlagOptions = {
        context: { user_id: 'user-123' },
        defaultValue: false,
        realtime: true,
      };
      expect(options).toBeDefined();
    });
  });

  describe('Re-exported Types from @savvagent/sdk', () => {
    it('should re-export FlagClient', () => {
      expect(AngularSDK.FlagClient).toBeDefined();
      expect(typeof AngularSDK.FlagClient).toBe('function');
    });

    // Type existence checks - these ensure types are exported
    it('should provide FlagClientConfig type', () => {
      const config: AngularSDK.FlagClientConfig = {
        apiKey: 'test',
      };
      expect(config).toBeDefined();
    });

    it('should provide FlagContext type', () => {
      const context: AngularSDK.FlagContext = {
        user_id: 'user-123',
        attributes: { key: 'value' },
      };
      expect(context).toBeDefined();
    });

    it('should provide FlagEvaluationResult type', () => {
      const result: AngularSDK.FlagEvaluationResult = {
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      };
      expect(result).toBeDefined();
    });
  });

  describe('Package Structure', () => {
    it('should export all documented APIs', () => {
      const expectedExports = [
        'SavvagentModule',
        'SavvagentService',
        'SAVVAGENT_CONFIG',
        'FlagClient',
      ];

      expectedExports.forEach((exportName) => {
        expect(AngularSDK).toHaveProperty(exportName);
      });
    });

    it('should not export internal implementation details', () => {
      // Ensure we're not accidentally exposing things we shouldn't
      const internalNames = ['private', 'internal'];
      const exportKeys = Object.keys(AngularSDK);

      internalNames.forEach((internalName) => {
        const hasInternal = exportKeys.some((key) =>
          key.toLowerCase().includes(internalName)
        );
        expect(hasInternal).toBe(false);
      });
    });
  });

  describe('Version and Metadata', () => {
    it('should be a valid package', () => {
      expect(AngularSDK).toBeDefined();
      expect(typeof AngularSDK).toBe('object');
    });

    it('should have non-empty exports', () => {
      const exportKeys = Object.keys(AngularSDK);
      expect(exportKeys.length).toBeGreaterThan(0);
    });
  });
});
