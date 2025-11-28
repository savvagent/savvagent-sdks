import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SavvagentProvider } from '../src/context';
import { useFlags } from '../src/hooks';
import { FlagClient, FlagEvaluationResult } from '@savvagent/sdk';

// Mock the FlagClient
const mockEvaluate = jest.fn();
const mockSubscribe = jest.fn();
const mockOnOverrideChange = jest.fn();
const mockClose = jest.fn();

jest.mock('@savvagent/sdk', () => ({
  FlagClient: jest.fn().mockImplementation(() => ({
    close: mockClose,
    evaluate: mockEvaluate,
    subscribe: mockSubscribe,
    onOverrideChange: mockOnOverrideChange,
  })),
}));

describe('useFlags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribe.mockReturnValue(jest.fn());
    mockOnOverrideChange.mockReturnValue(jest.fn());
  });

  it('should evaluate multiple flags', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: flagKey === 'flag-a',
      flagKey,
      reason: 'default',
      variant: null,
    }));

    const TestComponent = () => {
      const { values, loading } = useFlags(['flag-a', 'flag-b', 'flag-c']);
      return (
        <div>
          <div data-testid="flag-a">{values['flag-a'] ? 'true' : 'false'}</div>
          <div data-testid="flag-b">{values['flag-b'] ? 'true' : 'false'}</div>
          <div data-testid="flag-c">{values['flag-c'] ? 'true' : 'false'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('true');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('false');
      expect(screen.getByTestId('flag-c')).toHaveTextContent('false');
      expect(screen.getByTestId('loading')).toHaveTextContent('done');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(3);
    expect(mockEvaluate).toHaveBeenCalledWith('flag-a', expect.objectContaining({ attributes: {} }));
    expect(mockEvaluate).toHaveBeenCalledWith('flag-b', expect.objectContaining({ attributes: {} }));
    expect(mockEvaluate).toHaveBeenCalledWith('flag-c', expect.objectContaining({ attributes: {} }));
  });

  it('should use default values while loading', () => {
    mockEvaluate.mockImplementation(() => new Promise(() => {})); // Never resolves

    const TestComponent = () => {
      const { values, loading } = useFlags(['flag-a', 'flag-b'], {
        defaultValues: { 'flag-a': true, 'flag-b': false },
      });
      return (
        <div>
          <div data-testid="flag-a">{values['flag-a'] ? 'true' : 'false'}</div>
          <div data-testid="flag-b">{values['flag-b'] ? 'true' : 'false'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    expect(screen.getByTestId('flag-a')).toHaveTextContent('true');
    expect(screen.getByTestId('flag-b')).toHaveTextContent('false');
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('should merge context with default context from provider', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: false,
      flagKey,
      reason: 'default',
      variant: null,
    }));

    const TestComponent = () => {
      useFlags(['flag-a'], {
        context: { user_id: 'user-123', attributes: { role: 'admin' } },
      });
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider
        config={{ apiKey: 'test-key' }}
        defaultContext={{
          environment: 'production',
          attributes: { plan: 'pro' },
        }}
      >
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockEvaluate).toHaveBeenCalledWith('flag-a', {
        environment: 'production',
        user_id: 'user-123',
        attributes: {
          plan: 'pro',
          role: 'admin',
        },
      });
    });
  });

  it('should handle evaluation errors for individual flags', async () => {
    const mockError = new Error('Evaluation failed');
    mockEvaluate.mockImplementation(async (flagKey: string) => {
      if (flagKey === 'flag-b') {
        throw mockError;
      }
      return {
        value: true,
        flagKey,
        reason: 'default',
        variant: null,
      };
    });

    const onError = jest.fn();

    const TestComponent = () => {
      const { values, errors, loading } = useFlags(['flag-a', 'flag-b', 'flag-c'], {
        defaultValues: { 'flag-b': true },
        onError,
      });
      return (
        <div>
          <div data-testid="flag-a">{values['flag-a'] ? 'true' : 'false'}</div>
          <div data-testid="flag-b">{values['flag-b'] ? 'true' : 'false'}</div>
          <div data-testid="flag-c">{values['flag-c'] ? 'true' : 'false'}</div>
          <div data-testid="error-b">{errors['flag-b']?.message || 'no-error'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('true');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('true'); // Falls back to default
      expect(screen.getByTestId('flag-c')).toHaveTextContent('true');
      expect(screen.getByTestId('error-b')).toHaveTextContent('Evaluation failed');
      expect(screen.getByTestId('loading')).toHaveTextContent('done');
    });

    expect(onError).toHaveBeenCalledWith(mockError, 'flag-b');
  });

  it('should return evaluation results for all flags', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: true,
      flagKey,
      reason: flagKey === 'flag-a' ? 'targeting' : 'default',
      variant: flagKey === 'flag-a' ? 'variant-a' : null,
    }));

    const TestComponent = () => {
      const { results } = useFlags(['flag-a', 'flag-b']);
      return (
        <div>
          <div data-testid="reason-a">{results['flag-a']?.reason || 'none'}</div>
          <div data-testid="variant-a">{results['flag-a']?.variant || 'none'}</div>
          <div data-testid="reason-b">{results['flag-b']?.reason || 'none'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reason-a')).toHaveTextContent('targeting');
      expect(screen.getByTestId('variant-a')).toHaveTextContent('variant-a');
      expect(screen.getByTestId('reason-b')).toHaveTextContent('default');
    });
  });

  it('should support refetch functionality', async () => {
    let callCount = 0;
    mockEvaluate.mockImplementation(async (flagKey: string) => {
      callCount++;
      return {
        value: callCount > 2, // True after first 2 calls (one for each flag)
        flagKey,
        reason: 'default',
        variant: null,
      };
    });

    const TestComponent = () => {
      const { values, refetch } = useFlags(['flag-a', 'flag-b']);
      return (
        <div>
          <div data-testid="flag-a">{values['flag-a'] ? 'true' : 'false'}</div>
          <div data-testid="flag-b">{values['flag-b'] ? 'true' : 'false'}</div>
          <button onClick={() => refetch()}>Refetch</button>
        </div>
      );
    };

    const { getByText } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('false');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('false');
    });

    await act(async () => {
      getByText('Refetch').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('true');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('true');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(4); // 2 initial + 2 refetch
  });

  it('should subscribe to realtime updates for all flags when realtime is true', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: false,
      flagKey,
      reason: 'default',
      variant: null,
    }));

    const mockUnsubscribe = jest.fn();
    mockSubscribe.mockReturnValue(mockUnsubscribe);

    const TestComponent = () => {
      useFlags(['flag-a', 'flag-b'], { realtime: true });
      return <div>Test</div>;
    };

    const { unmount } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledTimes(2);
      expect(mockSubscribe).toHaveBeenCalledWith('flag-a', expect.any(Function));
      expect(mockSubscribe).toHaveBeenCalledWith('flag-b', expect.any(Function));
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
  });

  it('should not subscribe to realtime updates when realtime is false', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: false,
      flagKey,
      reason: 'default',
      variant: null,
    }));

    const TestComponent = () => {
      useFlags(['flag-a', 'flag-b'], { realtime: false });
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockEvaluate).toHaveBeenCalledTimes(2);
    });

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should re-evaluate when any flag update is received', async () => {
    let evaluationCount = 0;
    mockEvaluate.mockImplementation(async (flagKey: string) => {
      evaluationCount++;
      return {
        value: evaluationCount > 2,
        flagKey,
        reason: 'default',
        variant: null,
      };
    });

    let updateCallbacks: Array<() => void> = [];
    mockSubscribe.mockImplementation((flagKey, callback) => {
      updateCallbacks.push(callback);
      return jest.fn();
    });

    const TestComponent = () => {
      const { values } = useFlags(['flag-a', 'flag-b'], { realtime: true });
      return (
        <div>
          <div data-testid="flag-a">{values['flag-a'] ? 'true' : 'false'}</div>
          <div data-testid="flag-b">{values['flag-b'] ? 'true' : 'false'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('false');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('false');
    });

    // Simulate flag update for flag-a
    await act(async () => {
      updateCallbacks[0]();
    });

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('true');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('true');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(4); // 2 initial + 2 after update
  });

  it('should subscribe to override changes', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: false,
      flagKey,
      reason: 'default',
      variant: null,
    }));

    const mockUnsubscribe = jest.fn();
    mockOnOverrideChange.mockReturnValue(mockUnsubscribe);

    const TestComponent = () => {
      useFlags(['flag-a', 'flag-b']);
      return <div>Test</div>;
    };

    const { unmount } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockOnOverrideChange).toHaveBeenCalledWith(expect.any(Function));
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should re-evaluate all flags when override changes', async () => {
    let evaluationCount = 0;
    mockEvaluate.mockImplementation(async (flagKey: string) => {
      evaluationCount++;
      return {
        value: evaluationCount > 2,
        flagKey,
        reason: 'default',
        variant: null,
      };
    });

    let overrideCallback: (() => void) | undefined;
    mockOnOverrideChange.mockImplementation((callback) => {
      overrideCallback = callback;
      return jest.fn();
    });

    const TestComponent = () => {
      const { values } = useFlags(['flag-a', 'flag-b']);
      return (
        <div>
          <div data-testid="flag-a">{values['flag-a'] ? 'true' : 'false'}</div>
          <div data-testid="flag-b">{values['flag-b'] ? 'true' : 'false'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('false');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('false');
    });

    // Simulate override change
    await act(async () => {
      overrideCallback?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('flag-a')).toHaveTextContent('true');
      expect(screen.getByTestId('flag-b')).toHaveTextContent('true');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(4); // 2 initial + 2 after override change
  });

  it('should handle empty flag array', async () => {
    const TestComponent = () => {
      const { values, loading } = useFlags([]);
      return (
        <div>
          <div data-testid="count">{Object.keys(values).length}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0');
      expect(screen.getByTestId('loading')).toHaveTextContent('done');
    });

    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('should handle flag array changes', async () => {
    mockEvaluate.mockImplementation(async (flagKey: string) => ({
      value: true,
      flagKey,
      reason: 'default',
      variant: null,
    }));

    const TestComponent = ({ flags }: { flags: string[] }) => {
      const { values } = useFlags(flags);
      return (
        <div>
          <div data-testid="count">{Object.keys(values).length}</div>
          <div data-testid="flags">{Object.keys(values).join(',')}</div>
        </div>
      );
    };

    const { rerender } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent flags={['flag-a', 'flag-b']} />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('2');
      expect(screen.getByTestId('flags')).toHaveTextContent('flag-a,flag-b');
    });

    rerender(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent flags={['flag-a', 'flag-b', 'flag-c']} />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('3');
      expect(screen.getByTestId('flags')).toHaveTextContent('flag-a,flag-b,flag-c');
    });
  });
});
