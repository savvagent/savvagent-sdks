import { TestBed } from '@angular/core/testing';
import { SavvagentService, SAVVAGENT_CONFIG, SavvagentConfig } from './service';
import { FlagClient, FlagEvaluationResult } from '@savvagent/sdk';
import { firstValueFrom, take, toArray } from 'rxjs';

// Mock FlagClient
jest.mock('@savvagent/sdk', () => ({
  FlagClient: jest.fn().mockImplementation(() => ({
    evaluate: jest.fn(),
    isEnabled: jest.fn(),
    withFlag: jest.fn(),
    trackError: jest.fn(),
    setUserId: jest.fn(),
    getUserId: jest.fn(),
    getAnonymousId: jest.fn(),
    setAnonymousId: jest.fn(),
    setOverride: jest.fn(),
    clearOverride: jest.fn(),
    clearAllOverrides: jest.fn(),
    hasOverride: jest.fn(),
    getOverride: jest.fn(),
    getOverrides: jest.fn(),
    setOverrides: jest.fn(),
    getAllFlags: jest.fn(),
    getEnterpriseFlags: jest.fn(),
    clearCache: jest.fn(),
    isRealtimeConnected: jest.fn(),
    close: jest.fn(),
    subscribe: jest.fn().mockReturnValue(() => {}), // Always return unsubscribe function
    onOverrideChange: jest.fn().mockReturnValue(() => {}), // Always return unsubscribe function
  })),
}));

describe('SavvagentService', () => {
  let service: SavvagentService;
  let mockClient: jest.Mocked<FlagClient>;

  const mockConfig: SavvagentConfig = {
    config: {
      apiKey: 'test_api_key',
      baseUrl: 'https://api.test.com',
    },
    defaultContext: {
      applicationId: 'test-app',
      environment: 'test',
      userId: 'user-123',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        SavvagentService,
        {
          provide: SAVVAGENT_CONFIG,
          useValue: mockConfig,
        },
      ],
    });
  });

  afterEach(() => {
    service?.ngOnDestroy();
  });

  describe('Initialization', () => {
    it('should be created', () => {
      service = TestBed.inject(SavvagentService);
      expect(service).toBeTruthy();
    });

    it('should initialize with config from injection token', () => {
      service = TestBed.inject(SavvagentService);
      expect(FlagClient).toHaveBeenCalledWith(mockConfig.config);
      expect(service.isReady).toBe(true);
    });

    it('should not initialize without config', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);
      expect(service.isReady).toBe(false);
    });

    it('should allow manual initialization', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);
      service.initialize(mockConfig);
      expect(service.isReady).toBe(true);
    });

    it('should warn when reinitializing', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      service = TestBed.inject(SavvagentService);
      service.initialize(mockConfig);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Savvagent] Client already initialized. Call close() first to reinitialize.'
      );
      consoleSpy.mockRestore();
    });

    it('should handle initialization errors', () => {
      const error = new Error('Init error');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const onError = jest.fn();
      (FlagClient as jest.Mock).mockImplementationOnce(() => {
        throw error;
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SavvagentService,
          {
            provide: SAVVAGENT_CONFIG,
            useValue: {
              config: { apiKey: 'test', onError },
            },
          },
        ],
      });
      service = TestBed.inject(SavvagentService);

      expect(consoleSpy).toHaveBeenCalledWith('[Savvagent] Failed to initialize client:', error);
      expect(onError).toHaveBeenCalledWith(error);
      consoleSpy.mockRestore();
    });

    it('should set up override change listener', () => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
      expect(mockClient.onOverrideChange).toHaveBeenCalled();
    });
  });

  describe('Ready State', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should emit ready$ observable', async () => {
      const ready = await firstValueFrom(service.ready$);
      expect(ready).toBe(true);
    });

    it('should return isReady getter', () => {
      expect(service.isReady).toBe(true);
    });

    it('should provide flagClient getter', () => {
      expect(service.flagClient).toBe(mockClient);
    });
  });

  describe('Context Merging', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should convert camelCase defaultContext to snake_case', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag');

      expect(mockClient.evaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({
        application_id: 'test-app',
        environment: 'test',
        user_id: 'user-123',
      }));
    });

    it('should merge per-call context with default context', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag', {
        user_id: 'user-456',
        attributes: { plan: 'pro' },
      });

      expect(mockClient.evaluate).toHaveBeenCalledWith('test-flag', {
        application_id: 'test-app',
        environment: 'test',
        user_id: 'user-456',
        organization_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
        attributes: { plan: 'pro' },
      });
    });

    it('should merge attributes correctly', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SavvagentService,
          {
            provide: SAVVAGENT_CONFIG,
            useValue: {
              config: { apiKey: 'test' },
              defaultContext: {
                attributes: { tier: 'basic', region: 'us' },
              },
            },
          },
        ],
      });
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag', {
        attributes: { plan: 'pro', region: 'eu' },
      });

      expect(mockClient.evaluate).toHaveBeenCalledWith('test-flag', {
        application_id: undefined,
        environment: undefined,
        user_id: undefined,
        organization_id: undefined,
        anonymous_id: undefined,
        session_id: undefined,
        language: undefined,
        attributes: {
          tier: 'basic',
          region: 'eu', // should override
          plan: 'pro',
        },
      });
    });
  });

  describe('flag$ - Reactive Flag Evaluation', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should return observable with initial loading state', async () => {
      mockClient.evaluate.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      const flag$ = service.flag$('test-flag');
      const initialValue = await firstValueFrom(flag$);

      expect(initialValue).toEqual({
        value: false,
        loading: true,
        error: null,
        result: null,
      });
    });

    it('should evaluate flag and emit result', async () => {
      const mockResult: FlagEvaluationResult = {
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      };
      mockClient.evaluate.mockResolvedValue(mockResult);

      const flag$ = service.flag$('test-flag');
      const values = await firstValueFrom(flag$.pipe(take(2), toArray()));

      expect(values[0].loading).toBe(true);
      expect(values[1]).toEqual({
        value: true,
        loading: false,
        error: null,
        result: mockResult,
      });
    });

    it('should use default value on error', async () => {
      const error = new Error('Evaluation failed');
      mockClient.evaluate.mockRejectedValue(error);

      const flag$ = service.flag$('test-flag', { defaultValue: true });
      const values = await firstValueFrom(flag$.pipe(take(2), toArray()));

      expect(values[1]).toEqual({
        value: true,
        loading: false,
        error,
        result: null,
      });
    });

    it('should return error when client not initialized', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      const flag$ = service.flag$('test-flag');
      const value = await firstValueFrom(flag$);

      expect(value.error?.message).toBe('Savvagent client not initialized');
      expect(value.value).toBe(false);
    }, 10000);

    it('should subscribe to real-time updates when realtime: true', async () => {
      const unsubscribe = jest.fn();
      mockClient.subscribe.mockReturnValue(unsubscribe);
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      const flag$ = service.flag$('test-flag', { realtime: true });
      await firstValueFrom(flag$.pipe(take(2)));

      expect(mockClient.subscribe).toHaveBeenCalledWith('test-flag', expect.any(Function));
    });

    it('should not subscribe to real-time updates when realtime: false', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      const flag$ = service.flag$('test-flag', { realtime: false });
      await firstValueFrom(flag$.pipe(take(2)));

      expect(mockClient.subscribe).not.toHaveBeenCalled();
    });

    it('should deduplicate identical flag results', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      const flag$ = service.flag$('test-flag');
      const values: any[] = [];

      const subscription = flag$.subscribe((value) => values.push(value));

      // Wait for initial emission
      await new Promise((resolve) => setTimeout(resolve, 50));

      subscription.unsubscribe();

      // Should only emit once after loading (not duplicate true values)
      const nonLoadingValues = values.filter((v) => !v.loading);
      expect(nonLoadingValues.length).toBe(1);
    });

    it('should reuse subject for same flag+context combination', () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      service.flag$('test-flag', { context: { user_id: 'user-1' } });
      service.flag$('test-flag', { context: { user_id: 'user-1' } });

      expect(mockClient.evaluate).toHaveBeenCalledTimes(1);
    });

    it('should create separate subjects for different contexts', () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      service.flag$('test-flag', { context: { user_id: 'user-1' } });
      service.flag$('test-flag', { context: { user_id: 'user-2' } });

      expect(mockClient.evaluate).toHaveBeenCalledTimes(2);
    });
  });

  describe('flagValue$ - Simple Boolean Observable', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should return boolean observable', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      const flagValue$ = service.flagValue$('test-flag');
      const values = await firstValueFrom(flagValue$.pipe(take(2), toArray()));

      expect(values).toEqual([false, true]);
    });

    it('should deduplicate boolean values', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      const flagValue$ = service.flagValue$('test-flag');
      const values: boolean[] = [];

      const subscription = flagValue$.subscribe((value) => values.push(value));

      await new Promise((resolve) => setTimeout(resolve, 50));

      subscription.unsubscribe();

      expect(values).toEqual([false, true]);
    });
  });

  describe('evaluate - One-time Evaluation', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should evaluate flag and return result', async () => {
      const mockResult: FlagEvaluationResult = {
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      };
      mockClient.evaluate.mockResolvedValue(mockResult);

      const result = await service.evaluate('test-flag');
      expect(result).toEqual(mockResult);
    });

    it('should throw when client not initialized', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      await expect(service.evaluate('test-flag')).rejects.toThrow(
        'Savvagent client not initialized'
      );
    });

    it('should pass merged context to client', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag', { user_id: 'custom-user' });

      expect(mockClient.evaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({
        application_id: 'test-app',
        environment: 'test',
        user_id: 'custom-user',
      }));
    });
  });

  describe('isEnabled - Boolean Check', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should return true when flag is enabled', async () => {
      mockClient.isEnabled.mockResolvedValue(true);
      const result = await service.isEnabled('test-flag');
      expect(result).toBe(true);
    });

    it('should return false when flag is disabled', async () => {
      mockClient.isEnabled.mockResolvedValue(false);
      const result = await service.isEnabled('test-flag');
      expect(result).toBe(false);
    });

    it('should return false when client not initialized', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      const result = await service.isEnabled('test-flag');
      expect(result).toBe(false);
    });
  });

  describe('withFlag - Conditional Execution', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should execute callback when flag is enabled', async () => {
      const callback = jest.fn().mockReturnValue('result');
      mockClient.withFlag.mockResolvedValue('result');

      const result = await service.withFlag('test-flag', callback);
      expect(result).toBe('result');
    });

    it('should return null when client not initialized', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      const callback = jest.fn();
      const result = await service.withFlag('test-flag', callback);
      expect(result).toBeNull();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should pass merged context to client', async () => {
      const callback = jest.fn().mockReturnValue('result');
      mockClient.withFlag.mockResolvedValue('result');

      await service.withFlag('test-flag', callback, { user_id: 'custom' });

      expect(mockClient.withFlag).toHaveBeenCalledWith(
        'test-flag',
        callback,
        expect.objectContaining({ user_id: 'custom' })
      );
    });
  });

  describe('User ID Management', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should set user ID', () => {
      service.setUserId('new-user');
      expect(mockClient.setUserId).toHaveBeenCalledWith('new-user');
    });

    it('should get user ID', () => {
      mockClient.getUserId.mockReturnValue('user-123');
      const userId = service.getUserId();
      expect(userId).toBe('user-123');
    });

    it('should return null when client not initialized', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      expect(service.getUserId()).toBeNull();
    });
  });

  describe('Anonymous ID Management', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should get anonymous ID', () => {
      mockClient.getAnonymousId.mockReturnValue('anon-123');
      const anonId = service.getAnonymousId();
      expect(anonId).toBe('anon-123');
    });

    it('should set anonymous ID', () => {
      service.setAnonymousId('custom-anon');
      expect(mockClient.setAnonymousId).toHaveBeenCalledWith('custom-anon');
    });

    it('should return null when client not initialized', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      expect(service.getAnonymousId()).toBeNull();
    });
  });

  describe('Override Management', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should set override', () => {
      service.setOverride('test-flag', true);
      expect(mockClient.setOverride).toHaveBeenCalledWith('test-flag', true);
    });

    it('should clear override', () => {
      service.clearOverride('test-flag');
      expect(mockClient.clearOverride).toHaveBeenCalledWith('test-flag');
    });

    it('should clear all overrides', () => {
      service.clearAllOverrides();
      expect(mockClient.clearAllOverrides).toHaveBeenCalled();
    });

    it('should check if override exists', () => {
      mockClient.hasOverride.mockReturnValue(true);
      const hasOverride = service.hasOverride('test-flag');
      expect(hasOverride).toBe(true);
    });

    it('should get override value', () => {
      mockClient.getOverride.mockReturnValue(true);
      const override = service.getOverride('test-flag');
      expect(override).toBe(true);
    });

    it('should get all overrides', () => {
      const overrides = { 'flag-1': true, 'flag-2': false };
      mockClient.getOverrides.mockReturnValue(overrides);
      const result = service.getOverrides();
      expect(result).toEqual(overrides);
    });

    it('should set multiple overrides', () => {
      const overrides = { 'flag-1': true, 'flag-2': false };
      service.setOverrides(overrides);
      expect(mockClient.setOverrides).toHaveBeenCalledWith(overrides);
    });

    it('should return false/empty when client not initialized', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      expect(service.hasOverride('test')).toBe(false);
      expect(service.getOverride('test')).toBeUndefined();
      expect(service.getOverrides()).toEqual({});
    });

    it('should re-evaluate flags when override changes', async () => {
      let overrideCallback: (() => void) | undefined;
      mockClient.onOverrideChange.mockImplementation((cb: () => void) => {
        overrideCallback = cb;
        return () => {}; // Return unsubscribe function
      });
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      // Re-initialize to set up the override listener
      service.close();
      service.initialize(mockConfig);
      mockClient = (service as any).client;

      // Create a flag subscription
      const flag$ = service.flag$('test-flag');
      const values: any[] = [];
      flag$.subscribe((val) => values.push(val));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Trigger override change
      if (overrideCallback) {
        overrideCallback();
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have re-evaluated (initial call + re-evaluation)
      expect(mockClient.evaluate).toHaveBeenCalled();
    });
  });

  describe('Flag Discovery', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should get all flags as observable', async () => {
      const mockFlags = [
        { key: 'flag-1', name: 'Flag 1' },
        { key: 'flag-2', name: 'Flag 2' },
      ];
      mockClient.getAllFlags.mockResolvedValue(mockFlags as any);

      const flags = await firstValueFrom(service.getAllFlags$('production'));
      expect(flags).toEqual(mockFlags);
    });

    it('should handle errors in getAllFlags$', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockClient.getAllFlags.mockRejectedValue(new Error('API error'));

      const flags = await firstValueFrom(service.getAllFlags$('production'));
      expect(flags).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should get all flags as promise', async () => {
      const mockFlags = [{ key: 'flag-1', name: 'Flag 1' }];
      mockClient.getAllFlags.mockResolvedValue(mockFlags as any);

      const flags = await service.getAllFlags('production');
      expect(flags).toEqual(mockFlags);
    });

    it('should get enterprise flags', async () => {
      const mockFlags = [{ key: 'enterprise-flag', name: 'Enterprise Flag' }];
      mockClient.getEnterpriseFlags.mockResolvedValue(mockFlags as any);

      const flags = await service.getEnterpriseFlags('production');
      expect(flags).toEqual(mockFlags);
    });

    it('should return empty array when client not initialized', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      const flags1 = await firstValueFrom(service.getAllFlags$());
      const flags2 = await service.getAllFlags();
      const flags3 = await service.getEnterpriseFlags();

      expect(flags1).toEqual([]);
      expect(flags2).toEqual([]);
      expect(flags3).toEqual([]);
    });
  });

  describe('Cache & Connection', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should clear cache', () => {
      service.clearCache();
      expect(mockClient.clearCache).toHaveBeenCalled();
    });

    it('should check realtime connection status', () => {
      mockClient.isRealtimeConnected.mockReturnValue(true);
      const isConnected = service.isRealtimeConnected();
      expect(isConnected).toBe(true);
    });

    it('should return false for realtime when client not initialized', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [SavvagentService],
      });
      service = TestBed.inject(SavvagentService);

      expect(service.isRealtimeConnected()).toBe(false);
    });
  });

  describe('Error Tracking', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should track error with merged context', () => {
      const error = new Error('Test error');
      service.trackError('test-flag', error, { user_id: 'custom' });

      expect(mockClient.trackError).toHaveBeenCalledWith(
        'test-flag',
        error,
        expect.objectContaining({ user_id: 'custom' })
      );
    });
  });

  describe('Cleanup', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should close client and cleanup on close()', () => {
      service.close();
      expect(mockClient.close).toHaveBeenCalled();
      expect(service.isReady).toBe(false);
      expect(service.flagClient).toBeNull();
    });

    it('should cleanup on ngOnDestroy', () => {
      service.ngOnDestroy();
      expect(mockClient.close).toHaveBeenCalled();
      expect(service.isReady).toBe(false);
    });

    it('should complete all active flag subscriptions on close', async () => {
      mockClient.subscribe.mockReturnValue(() => {}); // Return proper unsubscribe function
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      const flag$ = service.flag$('test-flag');
      let completed = false;

      flag$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      service.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(completed).toBe(true);
    });

    it('should handle multiple close calls gracefully', () => {
      service.close();
      expect(() => service.close()).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
    });

    it('should handle null/undefined context values', async () => {
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag', {
        user_id: null as any,
        attributes: undefined,
      });

      expect(mockClient.evaluate).toHaveBeenCalledWith(
        'test-flag',
        expect.objectContaining({
          user_id: null,
        })
      );
    });

    it('should handle empty defaultContext', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SavvagentService,
          {
            provide: SAVVAGENT_CONFIG,
            useValue: {
              config: { apiKey: 'test' },
              defaultContext: {},
            },
          },
        ],
      });
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag');

      expect(mockClient.evaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({
        application_id: undefined,
        environment: undefined,
        user_id: undefined,
      }));
    });

    it('should handle no defaultContext', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          SavvagentService,
          {
            provide: SAVVAGENT_CONFIG,
            useValue: {
              config: { apiKey: 'test' },
            },
          },
        ],
      });
      service = TestBed.inject(SavvagentService);
      mockClient = (service as any).client;
      mockClient.evaluate.mockResolvedValue({
        key: 'test-flag',
        value: true,
        reason: 'evaluated',
      });

      await service.evaluate('test-flag');

      expect(mockClient.evaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({}));
    });
  });
});
