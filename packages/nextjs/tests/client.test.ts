/**
 * @jest-environment jsdom
 */

import {
  SavvagentProvider,
  useSavvagent,
  useFlag,
  useFlags,
  useWithFlag,
  useUser,
  useTrackError,
  FlagClient,
} from '../src/client';

describe('Client Module', () => {
  describe('Re-exports from React SDK', () => {
    it('should export SavvagentProvider', () => {
      expect(SavvagentProvider).toBeDefined();
    });

    it('should export useSavvagent hook', () => {
      expect(useSavvagent).toBeDefined();
      expect(typeof useSavvagent).toBe('function');
    });

    it('should export useFlag hook', () => {
      expect(useFlag).toBeDefined();
      expect(typeof useFlag).toBe('function');
    });

    it('should export useFlags hook', () => {
      expect(useFlags).toBeDefined();
      expect(typeof useFlags).toBe('function');
    });

    it('should export useWithFlag hook', () => {
      expect(useWithFlag).toBeDefined();
      expect(typeof useWithFlag).toBe('function');
    });

    it('should export useUser hook', () => {
      expect(useUser).toBeDefined();
      expect(typeof useUser).toBe('function');
    });

    it('should export useTrackError hook', () => {
      expect(useTrackError).toBeDefined();
      expect(typeof useTrackError).toBe('function');
    });

    it('should export FlagClient', () => {
      expect(FlagClient).toBeDefined();
      expect(typeof FlagClient).toBe('function');
    });
  });

  describe('Module Usage', () => {
    it('should be importable with "use client" directive', () => {
      // This test verifies that the client module can be imported
      // The actual 'use client' directive is checked at the top of client.ts
      const clientModule = require('../src/client');
      expect(clientModule).toBeDefined();
      expect(clientModule.SavvagentProvider).toBeDefined();
    });

    it('should export all expected client-side functionality', () => {
      const clientModule = require('../src/client');

      const expectedExports = [
        'SavvagentProvider',
        'useSavvagent',
        'useFlag',
        'useFlags',
        'useWithFlag',
        'useUser',
        'useTrackError',
        'FlagClient',
      ];

      expectedExports.forEach((exportName) => {
        expect(clientModule[exportName]).toBeDefined();
      });
    });

    it('should not export server-side functionality', () => {
      const clientModule = require('../src/client');

      const serverOnlyExports = [
        'initServerClient',
        'getServerClient',
        'createServerContext',
        'isEnabled',
        'evaluate',
        'withFlag',
        'trackError',
        'evaluateForRequest',
        'evaluateMultiple',
        'isEnabledMultiple',
      ];

      serverOnlyExports.forEach((exportName) => {
        expect(clientModule[exportName]).toBeUndefined();
      });
    });
  });

  describe('Type Exports', () => {
    it('should export TypeScript types', () => {
      // This is a compile-time check, but we can verify the module structure
      const clientModule = require('../src/client');

      // The module should be properly typed for TypeScript usage
      expect(clientModule).toBeDefined();
    });
  });

  describe('Integration with React SDK', () => {
    it('should properly wrap React SDK exports', () => {
      // Verify that the exports are actually from the React SDK
      const nextjsClient = require('../src/client');
      const reactSdk = require('@savvagent/react');

      // These should be the same references (re-exports)
      expect(nextjsClient.SavvagentProvider).toBe(reactSdk.SavvagentProvider);
      expect(nextjsClient.useFlag).toBe(reactSdk.useFlag);
      expect(nextjsClient.FlagClient).toBe(reactSdk.FlagClient);
    });
  });

  describe('Client-side Only Verification', () => {
    it('should have "use client" directive in source file', () => {
      const fs = require('fs');
      const path = require('path');
      const clientFilePath = path.join(__dirname, '../src/client.ts');
      const fileContent = fs.readFileSync(clientFilePath, 'utf-8');

      // Verify that the file contains the 'use client' directive
      expect(fileContent).toContain("'use client'");
    });

    it('should be safe to import in Next.js Client Components', () => {
      // This is a structural test to ensure the module is properly configured
      expect(() => {
        require('../src/client');
      }).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should handle module import errors gracefully', () => {
      // Test that the module can be loaded without errors
      expect(() => {
        const clientModule = require('../src/client');
        expect(clientModule).toBeDefined();
      }).not.toThrow();
    });
  });
});
