/**
 * Comprehensive unit tests for @savvagent/solid
 * Tests all exported primitives, SolidJS reactive patterns, provider/context patterns,
 * and edge cases/error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal as _createSignal } from 'solid-js';
import {
  SavvagentProvider,
  useSavvagent,
  createFlag,
  createFlagValue,
  createFlags,
  createWithFlag,
  createUser,
  createUserSignals,
  createTrackError,
  trackError,
} from './index';
import type { FlagClientConfig, FlagEvaluationResult, FlagContext } from '@savvagent/sdk';

// Create a mock client instance that we can spy on
const createMockClient = () => {
  let userId: string | null = null;
  let anonymousId: string | null = null;

  return {
    evaluate: vi.fn().mockResolvedValue({
      value: true,
      flagKey: 'test-flag',
      reason: 'MATCH',
      timestamp: Date.now(),
    } as FlagEvaluationResult),
    subscribe: vi.fn((_flagKey: string, _callback: () => void) => {
      return () => {};
    }),
    onOverrideChange: vi.fn((_callback: () => void) => {
      return () => {};
    }),
    withFlag: vi.fn(async (_flagKey: string, callback: () => void | Promise<void>, _context?: FlagContext) => {
      await callback();
    }),
    setUserId: vi.fn((id: string | null) => {
      userId = id;
    }),
    getUserId: vi.fn(() => userId),
    setAnonymousId: vi.fn((id: string) => {
      anonymousId = id;
    }),
    getAnonymousId: vi.fn(() => anonymousId),
    trackError: vi.fn(),
    close: vi.fn(),
  };
};

// Mock module
const mockClientInstance = createMockClient();

vi.mock('@savvagent/sdk', () => {
  return {
    FlagClient: class FlagClient {
      constructor(config: FlagClientConfig) {
        if ((config as any)._shouldThrow) {
          throw new Error('Initialization failed');
        }
        return mockClientInstance;
      }
    },
  };
});

describe('Savvagent Solid SDK', () => {
  beforeEach(() => {
    // Reset mock for each test - need to create new instance AND reset the module
    const newMock = createMockClient();
    // Copy all properties from new mock to the module-level instance
    Object.assign(mockClientInstance, newMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('SavvagentProvider', () => {
    it('should render children', () => {
      const TestComponent = () => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <div>Test Content</div>
        </SavvagentProvider>
      );

      render(() => <TestComponent />);
      expect(screen.getByText('Test Content')).toBeInTheDocument();
    });

    it('should handle initialization errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onError = vi.fn();

      // Wrap in try-catch since provider constructor throws during render
      try {
        render(() => (
          <SavvagentProvider config={{ apiKey: 'test-key', onError, _shouldThrow: true } as any}>
            <div>Test</div>
          </SavvagentProvider>
        ));
      } catch (e) {
        // Expected to throw during render
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Savvagent] Failed to initialize client:',
        expect.any(Error)
      );
      expect(onError).toHaveBeenCalledWith(expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it('should provide default context in camelCase to snake_case conversion', () => {
      const TestComponent = () => {
        const { defaultContext } = useSavvagent();
        return <div data-testid="context">{JSON.stringify(defaultContext())}</div>;
      };

      render(() => (
        <SavvagentProvider
          config={{ apiKey: 'test-key' }}
          defaultContext={{
            applicationId: 'app-123',
            environment: 'development',
            organizationId: 'org-456',
            userId: 'user-789',
            anonymousId: 'anon-012',
            sessionId: 'session-345',
            language: 'en',
            attributes: { plan: 'pro' },
          }}
        >
          <TestComponent />
        </SavvagentProvider>
      ));

      const context = JSON.parse(screen.getByTestId('context').textContent || '{}');
      expect(context).toEqual({
        application_id: 'app-123',
        environment: 'development',
        organization_id: 'org-456',
        user_id: 'user-789',
        anonymous_id: 'anon-012',
        session_id: 'session-345',
        language: 'en',
        attributes: { plan: 'pro' },
      });
    });

    it('should call client.close on cleanup', () => {
      const { unmount } = render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <div>Test</div>
        </SavvagentProvider>
      ));

      unmount();

      expect(mockClientInstance.close).toHaveBeenCalled();
    });
  });

  describe('useSavvagent', () => {
    it('should return context value when used within provider', () => {
      const TestComponent = () => {
        const { client, isReady, defaultContext: _defaultContext } = useSavvagent();
        return (
          <div>
            <div data-testid="has-client">{client ? 'yes' : 'no'}</div>
            <div data-testid="is-ready">{isReady() ? 'yes' : 'no'}</div>
          </div>
        );
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(screen.getByTestId('has-client').textContent).toBe('yes');
      expect(screen.getByTestId('is-ready').textContent).toBe('yes');
    });

    it('should throw error when used outside provider', () => {
      const TestComponent = () => {
        try {
          useSavvagent();
          return <div>Should not render</div>;
        } catch (error) {
          return <div data-testid="error">{(error as Error).message}</div>;
        }
      };

      render(() => <TestComponent />);
      expect(screen.getByTestId('error').textContent).toBe(
        'useSavvagent must be used within a SavvagentProvider'
      );
    });
  });

  describe('createFlag', () => {
    it('should return flag value and loading state', async () => {
      const TestComponent = () => {
        const flag = createFlag('test-flag');
        return (
          <div>
            <div data-testid="value">{flag.value() ? 'true' : 'false'}</div>
            <div data-testid="loading">{flag.loading() ? 'loading' : 'ready'}</div>
          </div>
        );
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('ready');
      });

      expect(screen.getByTestId('value').textContent).toBe('true');
    });

    it('should use default value when loading', () => {
      const TestComponent = () => {
        const flag = createFlag('test-flag', { defaultValue: false });
        return <div data-testid="value">{flag.value() ? 'true' : 'false'}</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      // Initial value should be default
      expect(screen.getByTestId('value').textContent).toBe('false');
    });

    it('should merge default context with per-call context', async () => {
      const TestComponent = () => {
        createFlag('test-flag', {
          context: { user_id: 'user-123', attributes: { role: 'admin' } },
        });
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider
          config={{ apiKey: 'test-key' }}
          defaultContext={{
            applicationId: 'app-123',
            attributes: { plan: 'pro' },
          }}
        >
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(mockClientInstance.evaluate).toHaveBeenCalledWith('test-flag', {
          application_id: 'app-123',
          user_id: 'user-123',
          attributes: {
            plan: 'pro',
            role: 'admin',
          },
        });
      });
    });

    it('should handle evaluation errors', async () => {
      const onError = vi.fn();
      const mockError = new Error('Evaluation failed');

      mockClientInstance.evaluate.mockRejectedValueOnce(mockError);

      const TestComponent = () => {
        const flag = createFlag('test-flag', { defaultValue: false, onError });
        return (
          <div>
            <div data-testid="value">{flag.value() ? 'true' : 'false'}</div>
            <div data-testid="has-error">{flag.error() ? 'yes' : 'no'}</div>
          </div>
        );
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      // Wait for error callback to be called
      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(mockError);
      });

      // Value should fall back to default when error occurs
      expect(screen.getByTestId('value').textContent).toBe('false');
    });

    it('should support refetch functionality', async () => {
      mockClientInstance.evaluate
        .mockResolvedValueOnce({
          value: true,
          flagKey: 'test-flag',
          reason: 'MATCH',
          timestamp: Date.now(),
        })
        .mockResolvedValueOnce({
          value: false,
          flagKey: 'test-flag',
          reason: 'DEFAULT',
          timestamp: Date.now(),
        });

      let refetchFn: () => void;

      const TestComponent = () => {
        const flag = createFlag('test-flag');
        refetchFn = flag.refetch;
        return <div data-testid="value">{flag.value() ? 'true' : 'false'}</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(screen.getByTestId('value').textContent).toBe('true');
      });

      refetchFn!();

      await waitFor(() => {
        expect(screen.getByTestId('value').textContent).toBe('false');
      });
    });

    it('should subscribe to real-time updates when enabled', async () => {
      const TestComponent = () => {
        createFlag('test-flag', { realtime: true });
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(mockClientInstance.subscribe).toHaveBeenCalledWith('test-flag', expect.any(Function));
      });
    });

    it('should not subscribe when realtime is false', async () => {
      const TestComponent = () => {
        createFlag('test-flag', { realtime: false });
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(mockClientInstance.subscribe).not.toHaveBeenCalled();
      });
    });
  });

  describe('createFlagValue', () => {
    it('should return only the flag value accessor', async () => {
      const TestComponent = () => {
        const isEnabled = createFlagValue('test-flag');
        return <div data-testid="value">{isEnabled() ? 'enabled' : 'disabled'}</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(screen.getByTestId('value').textContent).toBe('enabled');
      });
    });

    it('should accept options and pass them to createFlag', async () => {
      const TestComponent = () => {
        const isEnabled = createFlagValue('test-flag', { defaultValue: false });
        return <div data-testid="value">{isEnabled() ? 'enabled' : 'disabled'}</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      // Initial value should be default
      expect(screen.getByTestId('value').textContent).toBe('disabled');
    });
  });

  describe('createFlags', () => {
    it('should evaluate multiple flags in parallel', async () => {
      mockClientInstance.evaluate
        .mockResolvedValueOnce({
          value: true,
          flagKey: 'flag-1',
          reason: 'MATCH',
          timestamp: Date.now(),
        })
        .mockResolvedValueOnce({
          value: false,
          flagKey: 'flag-2',
          reason: 'DEFAULT',
          timestamp: Date.now(),
        })
        .mockResolvedValueOnce({
          value: true,
          flagKey: 'flag-3',
          reason: 'MATCH',
          timestamp: Date.now(),
        });

      const TestComponent = () => {
        const flags = createFlags(['flag-1', 'flag-2', 'flag-3']);
        return (
          <div>
            <div data-testid="loading">{flags.loading() ? 'loading' : 'ready'}</div>
            <div data-testid="values">{JSON.stringify(flags.values())}</div>
          </div>
        );
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('ready');
      });

      const values = JSON.parse(screen.getByTestId('values').textContent || '{}');
      expect(values).toEqual({
        'flag-1': true,
        'flag-2': false,
        'flag-3': true,
      });

      expect(mockClientInstance.evaluate).toHaveBeenCalledTimes(3);
    });

    it('should use default values', () => {
      const TestComponent = () => {
        const flags = createFlags(['flag-1', 'flag-2'], {
          defaultValues: { 'flag-1': true, 'flag-2': false },
        });
        return <div data-testid="values">{JSON.stringify(flags.values())}</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      // Initial values should be defaults
      const values = JSON.parse(screen.getByTestId('values').textContent || '{}');
      expect(values).toEqual({
        'flag-1': true,
        'flag-2': false,
      });
    });

    it('should handle evaluation errors gracefully', async () => {
      const onError = vi.fn();
      const mockError = new Error('Evaluation failed');

      mockClientInstance.evaluate
        .mockResolvedValueOnce({
          value: true,
          flagKey: 'flag-1',
          reason: 'MATCH',
          timestamp: Date.now(),
        })
        .mockRejectedValueOnce(mockError);

      const TestComponent = () => {
        const flags = createFlags(['flag-1', 'flag-2'], {
          defaultValues: { 'flag-2': false },
          onError,
        });
        return (
          <div>
            <div data-testid="values">{JSON.stringify(flags.values())}</div>
          </div>
        );
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(mockError, 'flag-2');
      });

      const values = JSON.parse(screen.getByTestId('values').textContent || '{}');
      expect(values['flag-1']).toBe(true);
      expect(values['flag-2']).toBe(false); // Default value after error
    });

    it('should subscribe to all flags for real-time updates', async () => {
      const TestComponent = () => {
        createFlags(['flag-1', 'flag-2', 'flag-3'], { realtime: true });
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(mockClientInstance.subscribe).toHaveBeenCalledWith('flag-1', expect.any(Function));
        expect(mockClientInstance.subscribe).toHaveBeenCalledWith('flag-2', expect.any(Function));
        expect(mockClientInstance.subscribe).toHaveBeenCalledWith('flag-3', expect.any(Function));
      });
    });

    it('should handle empty flag keys array', async () => {
      const TestComponent = () => {
        const flags = createFlags([]);
        return (
          <div>
            <div data-testid="loading">{flags.loading() ? 'loading' : 'ready'}</div>
            <div data-testid="values">{JSON.stringify(flags.values())}</div>
          </div>
        );
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(screen.getByTestId('loading').textContent).toBe('ready');
      });

      const values = JSON.parse(screen.getByTestId('values').textContent || '{}');
      expect(values).toEqual({});
    });
  });

  describe('createWithFlag', () => {
    it('should execute callback when flag is enabled', async () => {
      const callback = vi.fn();

      const TestComponent = () => {
        createWithFlag('test-flag', callback);
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(mockClientInstance.withFlag).toHaveBeenCalledWith(
          'test-flag',
          callback,
          undefined
        );
      });
    });

    it('should handle callback errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onError = vi.fn();
      const callbackError = new Error('Callback failed');

      mockClientInstance.withFlag.mockRejectedValueOnce(callbackError);

      const TestComponent = () => {
        createWithFlag('test-flag', async () => {}, { onError });
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[Savvagent] Error in withFlag callback for test-flag:',
          callbackError
        );
        expect(onError).toHaveBeenCalledWith(callbackError);
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('createUser', () => {
    it('should manage user ID', () => {
      const TestComponent = () => {
        const user = createUser();
        return (
          <div>
            <div data-testid="user-id">{user.userId() || 'none'}</div>
            <button onClick={() => user.setUserId('user-123')}>Set User</button>
          </div>
        );
      };

      const { container } = render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(screen.getByTestId('user-id').textContent).toBe('none');

      const button = container.querySelector('button');
      button?.click();

      expect(screen.getByTestId('user-id').textContent).toBe('user-123');
      expect(mockClientInstance.setUserId).toHaveBeenCalledWith('user-123');
    });

    it('should manage anonymous ID', () => {
      const TestComponent = () => {
        const user = createUser();
        return (
          <div>
            <div data-testid="anon-id">{user.anonymousId() || 'none'}</div>
            <button onClick={() => user.setAnonymousId('anon-456')}>Set Anonymous</button>
          </div>
        );
      };

      const { container } = render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(screen.getByTestId('anon-id').textContent).toBe('none');

      const button = container.querySelector('button');
      button?.click();

      expect(screen.getByTestId('anon-id').textContent).toBe('anon-456');
      expect(mockClientInstance.setAnonymousId).toHaveBeenCalledWith('anon-456');
    });
  });

  describe('createUserSignals (deprecated)', () => {
    it('should return user ID signal tuple', () => {
      const TestComponent = () => {
        const [userId, setUserId] = createUserSignals();
        return (
          <div>
            <div data-testid="user-id">{userId() || 'none'}</div>
            <button onClick={() => setUserId('user-789')}>Set User</button>
          </div>
        );
      };

      const { container } = render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(screen.getByTestId('user-id').textContent).toBe('none');

      const button = container.querySelector('button');
      button?.click();

      expect(screen.getByTestId('user-id').textContent).toBe('user-789');
      expect(mockClientInstance.setUserId).toHaveBeenCalledWith('user-789');
    });
  });

  describe('createTrackError', () => {
    it('should create error tracking function', () => {
      const error = new Error('Test error');

      const TestComponent = () => {
        const trackError = createTrackError('test-flag');
        trackError(error);
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, undefined);
    });

    it('should pass context to trackError', () => {
      const error = new Error('Test error');
      const context = { user_id: 'user-123' };

      const TestComponent = () => {
        const trackError = createTrackError('test-flag', context);
        trackError(error);
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, context);
    });
  });

  describe('trackError (standalone)', () => {
    it('should track errors directly', () => {
      const error = new Error('Test error');

      const TestComponent = () => {
        trackError('test-flag', error);
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, undefined);
    });

    it('should track errors with context', () => {
      const error = new Error('Test error');
      const context = { user_id: 'user-456' };

      const TestComponent = () => {
        trackError('test-flag', error, context);
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      expect(mockClientInstance.trackError).toHaveBeenCalledWith('test-flag', error, context);
    });
  });

  describe('Reactive patterns and edge cases', () => {
    it('should handle null/undefined context values', async () => {
      const TestComponent = () => {
        createFlag('test-flag', {
          context: {
            user_id: undefined,
            attributes: null as any,
          },
        });
        return <div>Test</div>;
      };

      render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      await waitFor(() => {
        expect(mockClientInstance.evaluate).toHaveBeenCalled();
      });
    });

    it('should properly cleanup subscriptions on unmount', () => {
      const mockUnsubscribe = vi.fn();
      const mockUnsubscribeOverride = vi.fn();

      mockClientInstance.subscribe.mockReturnValue(mockUnsubscribe);
      mockClientInstance.onOverrideChange.mockReturnValue(mockUnsubscribeOverride);

      const TestComponent = () => {
        createFlag('test-flag', { realtime: true });
        return <div>Test</div>;
      };

      const { unmount } = render(() => (
        <SavvagentProvider config={{ apiKey: 'test-key' }}>
          <TestComponent />
        </SavvagentProvider>
      ));

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(mockUnsubscribeOverride).toHaveBeenCalled();
    });
  });
});
