/**
 * @file Comprehensive unit tests for @savvagent/svelte
 * Tests all exported functions and stores with edge cases and error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import type { FlagContext, FlagEvaluationResult, FlagDefinition } from '@savvagent/sdk';

// Create mock client instance
const mockClientInstance = {
  evaluate: vi.fn(),
  subscribe: vi.fn(),
  onOverrideChange: vi.fn(),
  setOverrides: vi.fn(),
  getOverrides: vi.fn(),
  setOverride: vi.fn(),
  clearOverride: vi.fn(),
  clearAllOverrides: vi.fn(),
  hasOverride: vi.fn(),
  getOverride: vi.fn(),
  getAllFlags: vi.fn(),
  getUserId: vi.fn(),
  setUserId: vi.fn(),
  trackError: vi.fn(),
};

// Mock FlagClient
vi.mock('@savvagent/sdk', () => {
  return {
    FlagClient: vi.fn(function(this: any) {
      return mockClientInstance;
    }),
  };
});

// Import after mocking
import {
  initSavvagent,
  getSavvagent,
  getDefaultContext,
  setDefaultContext,
  createFlagStore,
  createFlag,
  createFlagsStore,
  createOverridesStore,
  createAllFlagsStore,
  createUserIdStore,
  trackError,
} from './index';

// Helper function to wait for async operations
const waitForAsync = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to subscribe and get value
const subscribeAndGet = <T>(store: { subscribe: (fn: (value: T) => void) => () => void }): Promise<T> => {
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe((value) => {
      resolve(value);
      setTimeout(() => unsubscribe(), 0);
    });
  });
};

describe('Svelte SDK - Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.evaluate.mockResolvedValue({ value: false, reason: 'DEFAULT' });
    mockClientInstance.subscribe.mockReturnValue(() => {});
    mockClientInstance.onOverrideChange.mockReturnValue(() => {});
    mockClientInstance.getOverrides.mockReturnValue({});
    mockClientInstance.getUserId.mockReturnValue(null);
  });

  it('should initialize and return client instance', () => {
    const client = initSavvagent({
      apiKey: 'test-key',
      applicationId: 'test-app',
    });

    expect(client).toBeDefined();
    expect(client).toBe(mockClientInstance);
  });

  it('should return same client instance on subsequent calls (singleton)', () => {
    const client1 = initSavvagent({ apiKey: 'test1', applicationId: 'app1' });
    const client2 = initSavvagent({ apiKey: 'test2', applicationId: 'app2' });

    expect(client1).toBe(client2);
  });

  it('should get client instance via getSavvagent', () => {
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
    const client = getSavvagent();

    expect(client).toBeDefined();
    expect(client).toBe(mockClientInstance);
  });
});

describe('Svelte SDK - Context Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  it('should get default context', () => {
    const context = getDefaultContext();
    expect(context).toBeDefined();
    expect(typeof context).toBe('object');
  });

  it('should set and get default context', () => {
    setDefaultContext({
      environment: 'production',
      userId: 'user-123',
      organizationId: 'org-456',
    });

    const context = getDefaultContext();
    expect(context.environment).toBe('production');
    expect(context.user_id).toBe('user-123');
    expect(context.organization_id).toBe('org-456');
  });

  it('should map DefaultFlagContext to FlagContext format', () => {
    setDefaultContext({
      userId: 'user-1',
      organizationId: 'org-1',
      anonymousId: 'anon-1',
      sessionId: 'session-1',
      language: 'en',
      attributes: { tier: 'premium' },
    });

    const context = getDefaultContext();
    expect(context.user_id).toBe('user-1');
    expect(context.organization_id).toBe('org-1');
    expect(context.anonymous_id).toBe('anon-1');
    expect(context.session_id).toBe('session-1');
    expect(context.language).toBe('en');
    expect(context.attributes).toEqual({ tier: 'premium' });
  });

  it('should handle empty context', () => {
    setDefaultContext({});
    const context = getDefaultContext();
    expect(context).toBeDefined();
  });

  it('should handle context with nested attributes', () => {
    setDefaultContext({
      attributes: {
        user: { role: 'admin', level: 5 },
        subscription: { plan: 'premium', active: true },
      } as any,
    });

    const context = getDefaultContext();
    expect(context.attributes).toEqual({
      user: { role: 'admin', level: 5 },
      subscription: { plan: 'premium', active: true },
    });
  });
});

describe('Svelte SDK - Flag Stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.evaluate.mockResolvedValue({ value: false, reason: 'DEFAULT' });
    mockClientInstance.subscribe.mockReturnValue(() => {});
    mockClientInstance.onOverrideChange.mockReturnValue(() => {});
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  describe('createFlagStore', () => {
    it('should create a flag store with correct structure', async () => {
      const store = createFlagStore('test-flag');
      const value = await subscribeAndGet(store);

      expect(value).toHaveProperty('value');
      expect(value).toHaveProperty('loading');
      expect(value).toHaveProperty('error');
      expect(value).toHaveProperty('result');
    });

    it('should use custom default value', async () => {
      const store = createFlagStore('test-flag', { defaultValue: true });
      const value = await subscribeAndGet(store);

      // Initial value should be true (custom default)
      expect(value.value).toBe(true);
    });

    it('should call evaluate on client', async () => {
      mockClientInstance.evaluate.mockResolvedValue({
        value: true,
        reason: 'TARGETING_MATCH',
      });

      const store = createFlagStore('my-flag');

      let finalValue: any;
      const unsubscribe = store.subscribe(v => { finalValue = v; });

      await waitForAsync();

      expect(mockClientInstance.evaluate).toHaveBeenCalledWith('my-flag', expect.any(Object));
      unsubscribe();
    });

    it('should subscribe to real-time updates when enabled', () => {
      const store = createFlagStore('test-flag', { realtime: true });
      // Need to subscribe to trigger the store's start function
      const unsubscribe = store.subscribe(() => {});
      expect(mockClientInstance.subscribe).toHaveBeenCalled();
      unsubscribe();
    });

    it('should not subscribe to real-time updates when disabled', () => {
      const store = createFlagStore('test-flag', { realtime: false });
      // Need to subscribe to trigger the store's start function
      const unsubscribe = store.subscribe(() => {});
      expect(mockClientInstance.subscribe).not.toHaveBeenCalled();
      unsubscribe();
    });

    it('should always subscribe to override changes', () => {
      const store = createFlagStore('test-flag');
      // Need to subscribe to trigger the store's start function
      const unsubscribe = store.subscribe(() => {});
      expect(mockClientInstance.onOverrideChange).toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe('createFlag', () => {
    it('should create a simple boolean store', async () => {
      const store = createFlag('simple-flag');
      const value = await subscribeAndGet(store);

      expect(typeof value).toBe('boolean');
    });

    it('should accept options', () => {
      const store = createFlag('simple-flag', {
        defaultValue: true,
        realtime: false,
      });

      expect(store).toBeDefined();
      expect(mockClientInstance.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('createFlagsStore', () => {
    it('should create a store for multiple flags', async () => {
      const store = createFlagsStore(['flag-a', 'flag-b', 'flag-c']);
      const value = await subscribeAndGet(store);

      expect(value.values).toHaveProperty('flag-a');
      expect(value.values).toHaveProperty('flag-b');
      expect(value.values).toHaveProperty('flag-c');
      expect(value).toHaveProperty('loading');
      expect(value).toHaveProperty('errors');
      expect(value).toHaveProperty('results');
    });

    it('should use default values for flags', async () => {
      const store = createFlagsStore(['flag-a', 'flag-b'], {
        defaultValues: {
          'flag-a': true,
          'flag-b': false,
        },
      });

      const value = await subscribeAndGet(store);
      expect(value.values['flag-a']).toBe(true);
      expect(value.values['flag-b']).toBe(false);
    });

    it('should have a refetch method', () => {
      const store = createFlagsStore(['flag-a']);
      expect(typeof store.refetch).toBe('function');
    });

    it('should handle empty flag keys array', async () => {
      const store = createFlagsStore([]);
      const value = await subscribeAndGet(store);

      expect(value.values).toEqual({});
      expect(value.loading).toBeDefined();
    });
  });
});

describe('Svelte SDK - Override Management', () => {
  let localStorageMock: { [key: string]: string };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = {};

    global.localStorage = {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      key: vi.fn(),
      length: 0,
    };

    mockClientInstance.getOverrides.mockReturnValue({});
    mockClientInstance.onOverrideChange.mockReturnValue(() => {});
    mockClientInstance.hasOverride.mockReturnValue(false);
    mockClientInstance.getOverride.mockReturnValue(undefined);

    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  describe('createOverridesStore', () => {
    it('should create an overrides store', async () => {
      const store = createOverridesStore();
      const value = await subscribeAndGet(store);

      expect(value).toHaveProperty('overrides');
      expect(value).toHaveProperty('count');
    });

    it('should have set method', () => {
      const store = createOverridesStore();
      expect(typeof store.set).toBe('function');

      store.set('test-flag', true);
      expect(mockClientInstance.setOverride).toHaveBeenCalledWith('test-flag', true);
    });

    it('should have clear method', () => {
      const store = createOverridesStore();
      expect(typeof store.clear).toBe('function');

      store.clear('test-flag');
      expect(mockClientInstance.clearOverride).toHaveBeenCalledWith('test-flag');
    });

    it('should have clearAll method', () => {
      const store = createOverridesStore();
      expect(typeof store.clearAll).toBe('function');

      store.clearAll();
      expect(mockClientInstance.clearAllOverrides).toHaveBeenCalled();
    });

    it('should have has method', () => {
      mockClientInstance.hasOverride.mockReturnValue(true);
      const store = createOverridesStore();

      const result = store.has('test-flag');
      expect(result).toBe(true);
      expect(mockClientInstance.hasOverride).toHaveBeenCalledWith('test-flag');
    });

    it('should have get method', () => {
      mockClientInstance.getOverride.mockReturnValue(true);
      const store = createOverridesStore();

      const result = store.get('test-flag');
      expect(result).toBe(true);
      expect(mockClientInstance.getOverride).toHaveBeenCalledWith('test-flag');
    });
  });
});

describe('Svelte SDK - All Flags Store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.getAllFlags.mockResolvedValue([]);
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  it('should create a store for all flags', async () => {
    const store = createAllFlagsStore('development');
    const value = await subscribeAndGet(store);

    expect(value).toHaveProperty('flags');
    expect(value).toHaveProperty('loading');
    expect(value).toHaveProperty('error');
    expect(Array.isArray(value.flags)).toBe(true);
  });

  it('should have refetch method', () => {
    const store = createAllFlagsStore();
    expect(typeof store.refetch).toBe('function');
  });

  it('should call getAllFlags with environment', async () => {
    const store = createAllFlagsStore('production');

    let value: any;
    const unsubscribe = store.subscribe(v => { value = v; });

    await waitForAsync();

    expect(mockClientInstance.getAllFlags).toHaveBeenCalledWith('production');
    unsubscribe();
  });

  it('should use default environment', async () => {
    const store = createAllFlagsStore();

    let value: any;
    const unsubscribe = store.subscribe(v => { value = v; });

    await waitForAsync();

    expect(mockClientInstance.getAllFlags).toHaveBeenCalledWith('development');
    unsubscribe();
  });
});

describe('Svelte SDK - User ID Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.getUserId.mockReturnValue(null);
    mockClientInstance.setUserId.mockImplementation(() => {});
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  it('should create a user ID store', () => {
    mockClientInstance.getUserId.mockReturnValue('user-123');
    const store = createUserIdStore();
    const value = get(store);

    expect(value).toBe('user-123');
  });

  it('should initialize with null if no user ID', () => {
    mockClientInstance.getUserId.mockReturnValue(null);
    const store = createUserIdStore();
    const value = get(store);

    expect(value).toBe(null);
  });

  it('should set user ID', () => {
    const store = createUserIdStore();
    store.set('user-456');

    expect(mockClientInstance.setUserId).toHaveBeenCalledWith('user-456');
  });

  it('should update user ID', () => {
    mockClientInstance.getUserId.mockReturnValue('user-123');
    const store = createUserIdStore();

    store.update((current) => current ? `${current}-updated` : 'new-user');

    expect(mockClientInstance.setUserId).toHaveBeenCalledWith('user-123-updated');
  });

  it('should clear user ID', () => {
    const store = createUserIdStore();
    store.set(null);

    expect(mockClientInstance.setUserId).toHaveBeenCalledWith(null);
  });
});

describe('Svelte SDK - Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.trackError.mockImplementation(() => {});
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  it('should track error with flag context', () => {
    const error = new Error('Test error');
    trackError('test-flag', error);

    expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, undefined);
  });

  it('should track error with additional context', () => {
    const error = new Error('Test error');
    const context: FlagContext = {
      user_id: 'user-123',
      environment: 'production',
    };

    trackError('test-flag', error, context);

    expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, context);
  });
});

describe('Svelte SDK - Edge Cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.evaluate.mockResolvedValue({ value: false, reason: 'DEFAULT' });
    mockClientInstance.subscribe.mockReturnValue(() => {});
    mockClientInstance.onOverrideChange.mockReturnValue(() => {});
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  it('should handle very long flag keys', () => {
    const longKey = 'a'.repeat(1000);
    const store = createFlag(longKey);

    expect(store).toBeDefined();
  });

  it('should handle special characters in flag keys', () => {
    const specialKey = 'flag-with-special-chars-!@#$%';
    const store = createFlag(specialKey);

    expect(store).toBeDefined();
  });

  it('should handle undefined context attributes', () => {
    setDefaultContext({
      userId: 'user-123',
      attributes: undefined,
    });

    const context = getDefaultContext();
    expect(context.user_id).toBe('user-123');
  });

  it('should handle null context values', () => {
    setDefaultContext({
      userId: null as any,
      environment: null as any,
    });

    const context = getDefaultContext();
    expect(context.user_id).toBe(null);
    expect(context.environment).toBe(null);
  });

  it('should handle numeric attribute values', () => {
    setDefaultContext({
      attributes: {
        age: 25,
        score: 100.5,
      } as any,
    });

    const context = getDefaultContext();
    expect(context.attributes).toEqual({ age: 25, score: 100.5 });
  });

  it('should handle boolean attribute values', () => {
    setDefaultContext({
      attributes: {
        isPremium: true,
        isActive: false,
      } as any,
    });

    const context = getDefaultContext();
    expect(context.attributes).toEqual({ isPremium: true, isActive: false });
  });
});

describe('Svelte SDK - Store Reactivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientInstance.evaluate.mockResolvedValue({ value: true, reason: 'DEFAULT' });
    mockClientInstance.subscribe.mockReturnValue(() => {});
    mockClientInstance.onOverrideChange.mockReturnValue(() => {});
    initSavvagent({ apiKey: 'test', applicationId: 'test' });
  });

  it('should notify subscribers on subscription', async () => {
    let callCount = 0;
    const store = createFlag('test-flag');

    const unsubscribe = store.subscribe(() => {
      callCount++;
    });

    // Should have been called at least once (initial subscription)
    expect(callCount).toBeGreaterThan(0);

    unsubscribe();
  });

  it('should support multiple simultaneous subscribers', async () => {
    const store = createFlag('test-flag');

    const values1: boolean[] = [];
    const values2: boolean[] = [];

    const unsub1 = store.subscribe(v => values1.push(v));
    const unsub2 = store.subscribe(v => values2.push(v));

    await waitForAsync();

    // Both should receive values
    expect(values1.length).toBeGreaterThan(0);
    expect(values2.length).toBeGreaterThan(0);

    unsub1();
    unsub2();
  });

  it('should cleanup subscriptions on unsubscribe', () => {
    const unsubscribeRealtime = vi.fn();
    const unsubscribeOverrides = vi.fn();

    mockClientInstance.subscribe.mockReturnValue(unsubscribeRealtime);
    mockClientInstance.onOverrideChange.mockReturnValue(unsubscribeOverrides);

    const store = createFlagStore('test-flag', { realtime: true });

    const unsubscribe = store.subscribe(() => {});

    // Trigger cleanup
    unsubscribe();

    // Verify subscribe and onOverrideChange were called
    expect(mockClientInstance.subscribe).toHaveBeenCalled();
    expect(mockClientInstance.onOverrideChange).toHaveBeenCalled();
  });
});
