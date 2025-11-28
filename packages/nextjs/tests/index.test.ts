/**
 * @jest-environment node
 */

import {
  initServerClient,
  getServerClient,
  createServerContext,
  isEnabled,
  evaluate,
  withFlag,
  trackError,
  evaluateForRequest,
  evaluateMultiple,
  isEnabledMultiple,
  FlagClient,
} from '../src/index';

describe('Index Module (Main Entry Point)', () => {
  describe('Server-side Exports', () => {
    it('should export initServerClient', () => {
      expect(initServerClient).toBeDefined();
      expect(typeof initServerClient).toBe('function');
    });

    it('should export getServerClient', () => {
      expect(getServerClient).toBeDefined();
      expect(typeof getServerClient).toBe('function');
    });

    it('should export createServerContext', () => {
      expect(createServerContext).toBeDefined();
      expect(typeof createServerContext).toBe('function');
    });

    it('should export isEnabled', () => {
      expect(isEnabled).toBeDefined();
      expect(typeof isEnabled).toBe('function');
    });

    it('should export evaluate', () => {
      expect(evaluate).toBeDefined();
      expect(typeof evaluate).toBe('function');
    });

    it('should export withFlag', () => {
      expect(withFlag).toBeDefined();
      expect(typeof withFlag).toBe('function');
    });

    it('should export trackError', () => {
      expect(trackError).toBeDefined();
      expect(typeof trackError).toBe('function');
    });

    it('should export evaluateForRequest', () => {
      expect(evaluateForRequest).toBeDefined();
      expect(typeof evaluateForRequest).toBe('function');
    });

    it('should export evaluateMultiple', () => {
      expect(evaluateMultiple).toBeDefined();
      expect(typeof evaluateMultiple).toBe('function');
    });

    it('should export isEnabledMultiple', () => {
      expect(isEnabledMultiple).toBeDefined();
      expect(typeof isEnabledMultiple).toBe('function');
    });

    it('should export FlagClient', () => {
      expect(FlagClient).toBeDefined();
      expect(typeof FlagClient).toBe('function');
    });
  });

  describe('Export Consistency', () => {
    it('should export server functions from server module', () => {
      const indexModule = require('../src/index');
      const serverModule = require('../src/server');

      // Verify that server exports are the same
      expect(indexModule.initServerClient).toBe(serverModule.initServerClient);
      expect(indexModule.getServerClient).toBe(serverModule.getServerClient);
      expect(indexModule.isEnabled).toBe(serverModule.isEnabled);
      expect(indexModule.evaluate).toBe(serverModule.evaluate);
    });

    it('should not export client-side functionality from main index', () => {
      const indexModule = require('../src/index');

      const clientOnlyExports = [
        'SavvagentProvider',
        'useSavvagent',
        'useFlag',
        'useFlags',
        'useWithFlag',
        'useUser',
        'useTrackError',
      ];

      clientOnlyExports.forEach((exportName) => {
        expect(indexModule[exportName]).toBeUndefined();
      });
    });

    it('should not export middleware functionality from main index', () => {
      const indexModule = require('../src/index');

      const middlewareOnlyExports = [
        'initMiddlewareClient',
        'getMiddlewareClient',
        'getRequestContext',
        'isEnabledInMiddleware',
        'createMiddleware',
        'redirectIfEnabled',
        'rewriteIfEnabled',
      ];

      middlewareOnlyExports.forEach((exportName) => {
        expect(indexModule[exportName]).toBeUndefined();
      });
    });
  });

  describe('Default Export Strategy', () => {
    it('should default to server-side exports for App Router', () => {
      // The main index exports server-side by default for Next.js App Router
      const indexModule = require('../src/index');

      // Verify presence of key server functions
      expect(indexModule.initServerClient).toBeDefined();
      expect(indexModule.isEnabled).toBeDefined();
      expect(indexModule.evaluate).toBeDefined();
    });
  });

  describe('Package.json Exports', () => {
    it('should have proper package exports structure', () => {
      const packageJson = require('../package.json');

      expect(packageJson.exports).toBeDefined();
      expect(packageJson.exports['.']).toBeDefined();
      expect(packageJson.exports['./client']).toBeDefined();
      expect(packageJson.exports['./server']).toBeDefined();
      expect(packageJson.exports['./middleware']).toBeDefined();
    });

    it('should specify correct entry points', () => {
      const packageJson = require('../package.json');

      // Main entry
      expect(packageJson.exports['.'].import).toContain('index.mjs');
      expect(packageJson.exports['.'].require).toContain('index.js');
      expect(packageJson.exports['.'].types).toContain('index.d.ts');

      // Client entry
      expect(packageJson.exports['./client'].import).toContain('client.mjs');
      expect(packageJson.exports['./client'].require).toContain('client.js');

      // Server entry
      expect(packageJson.exports['./server'].import).toContain('server.mjs');
      expect(packageJson.exports['./server'].require).toContain('server.js');

      // Middleware entry
      expect(packageJson.exports['./middleware'].import).toContain('middleware.mjs');
      expect(packageJson.exports['./middleware'].require).toContain('middleware.js');
    });
  });

  describe('Module Loading', () => {
    it('should load main module without errors', () => {
      expect(() => {
        require('../src/index');
      }).not.toThrow();
    });

    it('should load client module without errors', () => {
      expect(() => {
        require('../src/client');
      }).not.toThrow();
    });

    it('should load server module without errors', () => {
      expect(() => {
        require('../src/server');
      }).not.toThrow();
    });

    it('should load middleware module without errors', () => {
      expect(() => {
        require('../src/middleware');
      }).not.toThrow();
    });
  });

  describe('TypeScript Type Exports', () => {
    it('should export necessary types', () => {
      // This is primarily a compile-time check, but we can verify module structure
      const indexModule = require('../src/index');
      expect(indexModule).toBeDefined();
    });
  });

  describe('Documentation Comments', () => {
    it('should have package documentation', () => {
      const fs = require('fs');
      const path = require('path');
      const indexFilePath = path.join(__dirname, '../src/index.ts');
      const fileContent = fs.readFileSync(indexFilePath, 'utf-8');

      // Verify that the file has JSDoc comments
      expect(fileContent).toContain('@packageDocumentation');
      expect(fileContent).toContain('Next.js SDK for Savvagent');
    });

    it('should provide usage examples in comments', () => {
      const fs = require('fs');
      const path = require('path');
      const indexFilePath = path.join(__dirname, '../src/index.ts');
      const fileContent = fs.readFileSync(indexFilePath, 'utf-8');

      // Verify that usage examples are documented
      expect(fileContent).toContain('@savvagent/nextjs/client');
      expect(fileContent).toContain('@savvagent/nextjs/server');
      expect(fileContent).toContain('@savvagent/nextjs/middleware');
    });
  });

  describe('Dependency Management', () => {
    it('should have correct peer dependencies', () => {
      const packageJson = require('../package.json');

      expect(packageJson.peerDependencies).toBeDefined();
      expect(packageJson.peerDependencies.next).toBeDefined();
      expect(packageJson.peerDependencies.react).toBeDefined();
    });

    it('should depend on internal SDKs', () => {
      const packageJson = require('../package.json');

      expect(packageJson.dependencies).toBeDefined();
      expect(packageJson.dependencies['@savvagent/sdk']).toBeDefined();
      expect(packageJson.dependencies['@savvagent/react']).toBeDefined();
    });
  });

  describe('Build Configuration', () => {
    it('should have build scripts configured', () => {
      const packageJson = require('../package.json');

      expect(packageJson.scripts).toBeDefined();
      expect(packageJson.scripts.build).toBeDefined();
      expect(packageJson.scripts.test).toBeDefined();
    });

    it('should specify correct files to publish', () => {
      const packageJson = require('../package.json');

      expect(packageJson.files).toBeDefined();
      expect(packageJson.files).toContain('dist');
    });
  });

  describe('Integration Tests', () => {
    it('should work with Next.js version constraints', () => {
      const packageJson = require('../package.json');

      // Verify Next.js version requirement
      expect(packageJson.peerDependencies.next).toMatch(/>=13\.0\.0/);
    });

    it('should work with React version constraints', () => {
      const packageJson = require('../package.json');

      // Verify React version requirement
      expect(packageJson.peerDependencies.react).toMatch(/>=18\.0\.0/);
    });
  });
});
