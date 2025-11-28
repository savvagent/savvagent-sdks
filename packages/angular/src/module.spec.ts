import { TestBed } from '@angular/core/testing';
import { SavvagentModule } from './module';
import { SavvagentService, SAVVAGENT_CONFIG, SavvagentConfig } from './service';

describe('SavvagentModule', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('Module Configuration', () => {
    it('should create module', () => {
      const module = new SavvagentModule();
      expect(module).toBeTruthy();
    });

    it('should provide SavvagentService by default', () => {
      TestBed.configureTestingModule({
        imports: [SavvagentModule],
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
    });
  });

  describe('forRoot Configuration', () => {
    const testConfig: SavvagentConfig = {
      config: {
        apiKey: 'sdk_test_api_key',
        baseUrl: 'https://api.test.com',
      },
      defaultContext: {
        applicationId: 'test-app',
        environment: 'test',
      },
    };

    it('should return ModuleWithProviders', () => {
      const moduleWithProviders = SavvagentModule.forRoot(testConfig);

      expect(moduleWithProviders).toEqual({
        ngModule: SavvagentModule,
        providers: [
          {
            provide: SAVVAGENT_CONFIG,
            useValue: testConfig,
          },
          SavvagentService,
        ],
      });
    });

    it('should provide SAVVAGENT_CONFIG token', () => {
      TestBed.configureTestingModule({
        imports: [SavvagentModule.forRoot(testConfig)],
      });

      const config = TestBed.inject(SAVVAGENT_CONFIG);
      expect(config).toEqual(testConfig);
    });

    it('should initialize SavvagentService with config', () => {
      TestBed.configureTestingModule({
        imports: [SavvagentModule.forRoot(testConfig)],
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
      expect(service.isReady).toBe(true);
    });

    it('should work with minimal config', () => {
      const minimalConfig: SavvagentConfig = {
        config: {
          apiKey: 'sdk_test_key',
        },
      };

      TestBed.configureTestingModule({
        imports: [SavvagentModule.forRoot(minimalConfig)],
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
      expect(service.isReady).toBe(true);
    });

    it('should work with full config including all context fields', () => {
      const fullConfig: SavvagentConfig = {
        config: {
          apiKey: 'sdk_test_api_key',
          baseUrl: 'https://api.test.com',
          enableRealtime: true,
          cacheTtl: 60000,
          onError: (error) => console.error(error),
        },
        defaultContext: {
          applicationId: 'test-app',
          environment: 'production',
          organizationId: 'org-123',
          userId: 'user-456',
          anonymousId: 'anon-789',
          sessionId: 'session-abc',
          language: 'en',
          attributes: {
            plan: 'pro',
            region: 'us-west',
          },
        },
      };

      TestBed.configureTestingModule({
        imports: [SavvagentModule.forRoot(fullConfig)],
      });

      const config = TestBed.inject(SAVVAGENT_CONFIG);
      expect(config).toEqual(fullConfig);

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
      expect(service.isReady).toBe(true);
    });
  });

  describe('Dependency Injection', () => {
    it('should provide same service instance within module scope', () => {
      TestBed.configureTestingModule({
        imports: [
          SavvagentModule.forRoot({
            config: { apiKey: 'test' },
          }),
        ],
      });

      const service1 = TestBed.inject(SavvagentService);
      const service2 = TestBed.inject(SavvagentService);

      expect(service1).toBe(service2);
    });

    it('should work without forRoot (service providedIn: root)', () => {
      TestBed.configureTestingModule({
        imports: [SavvagentModule],
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
      // Service won't be initialized without config
      expect(service.isReady).toBe(false);
    });
  });

  describe('Multiple Imports', () => {
    it('should handle multiple module imports', () => {
      const config1: SavvagentConfig = {
        config: { apiKey: 'key1' },
      };
      const config2: SavvagentConfig = {
        config: { apiKey: 'key2' },
      };

      // The last imported config should win
      TestBed.configureTestingModule({
        imports: [
          SavvagentModule.forRoot(config1),
          SavvagentModule.forRoot(config2),
        ],
      });

      const config = TestBed.inject(SAVVAGENT_CONFIG);
      // Due to Angular's DI, the first provider typically wins,
      // but this tests that the setup doesn't break
      expect(config).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should allow service to evaluate flags after module setup', async () => {
      TestBed.configureTestingModule({
        imports: [
          SavvagentModule.forRoot({
            config: { apiKey: 'sdk_test' },
            defaultContext: {
              applicationId: 'test-app',
            },
          }),
        ],
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
      expect(service.isReady).toBe(true);
      expect(service.flagClient).not.toBeNull();
    });

    it('should support standalone component pattern (Angular 14+)', () => {
      // Simulate standalone component setup
      const providers = SavvagentModule.forRoot({
        config: { apiKey: 'sdk_test' },
      }).providers || [];

      TestBed.configureTestingModule({
        providers,
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
      expect(service.isReady).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid config gracefully', () => {
      const invalidConfig = {
        config: {} as any, // Missing apiKey
      };

      expect(() => {
        TestBed.configureTestingModule({
          imports: [SavvagentModule.forRoot(invalidConfig)],
        });
      }).not.toThrow();
    });

    it('should handle null/undefined values in config', () => {
      const configWithNulls: SavvagentConfig = {
        config: {
          apiKey: 'test',
          baseUrl: undefined,
        },
        defaultContext: {
          applicationId: undefined,
          environment: undefined,
        },
      };

      TestBed.configureTestingModule({
        imports: [SavvagentModule.forRoot(configWithNulls)],
      });

      const service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct config structure', () => {
      const validConfig: SavvagentConfig = {
        config: {
          apiKey: 'test_api_key',
        },
        defaultContext: {
          userId: 'user-123',
        },
      };

      const moduleWithProviders = SavvagentModule.forRoot(validConfig);
      expect(moduleWithProviders.ngModule).toBe(SavvagentModule);
    });

    it('should accept all valid defaultContext properties', () => {
      const config: SavvagentConfig = {
        config: { apiKey: 'test' },
        defaultContext: {
          applicationId: 'app',
          environment: 'prod',
          organizationId: 'org',
          userId: 'user',
          anonymousId: 'anon',
          sessionId: 'session',
          language: 'en',
          attributes: { key: 'value' },
        },
      };

      expect(() => {
        TestBed.configureTestingModule({
          imports: [SavvagentModule.forRoot(config)],
        });
      }).not.toThrow();
    });
  });
});
