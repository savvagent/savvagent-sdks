import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SavvagentProvider } from '../src/context';
import { useFlag } from '../src/hooks';
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

describe('useFlag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribe.mockReturnValue(jest.fn());
    mockOnOverrideChange.mockReturnValue(jest.fn());
  });

  it('should evaluate flag and return value', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'default',
      variant: null,
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const TestComponent = () => {
      const { value, loading, error } = useFlag('test-flag');
      return (
        <div>
          <div data-testid="value">{value ? 'true' : 'false'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
          <div data-testid="error">{error ? 'error' : 'no-error'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('true');
      expect(screen.getByTestId('loading')).toHaveTextContent('done');
      expect(screen.getByTestId('error')).toHaveTextContent('no-error');
    });

    expect(mockEvaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({
      attributes: {},
    }));
  });

  it('should use default value while loading', () => {
    mockEvaluate.mockImplementation(() => new Promise(() => {})); // Never resolves

    const TestComponent = () => {
      const { value, loading } = useFlag('test-flag', { defaultValue: true });
      return (
        <div>
          <div data-testid="value">{value ? 'true' : 'false'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    expect(screen.getByTestId('value')).toHaveTextContent('true');
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
  });

  it('should merge context with default context from provider', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'default',
      variant: null,
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const TestComponent = () => {
      useFlag('test-flag', {
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
      expect(mockEvaluate).toHaveBeenCalledWith('test-flag', {
        environment: 'production',
        user_id: 'user-123',
        attributes: {
          plan: 'pro',
          role: 'admin',
        },
      });
    });
  });

  it('should handle evaluation errors', async () => {
    const mockError = new Error('Evaluation failed');
    mockEvaluate.mockRejectedValue(mockError);

    const onError = jest.fn();

    const TestComponent = () => {
      const { value, loading, error } = useFlag('test-flag', {
        defaultValue: true,
        onError,
      });
      return (
        <div>
          <div data-testid="value">{value ? 'true' : 'false'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
          <div data-testid="error">{error ? error.message : 'no-error'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('true'); // Falls back to default
      expect(screen.getByTestId('loading')).toHaveTextContent('done');
      expect(screen.getByTestId('error')).toHaveTextContent('Evaluation failed');
    });

    expect(onError).toHaveBeenCalledWith(mockError);
  });

  it('should return evaluation result', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'targeting',
      variant: 'variant-a',
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const TestComponent = () => {
      const { result } = useFlag('test-flag');
      return (
        <div>
          <div data-testid="reason">{result?.reason || 'none'}</div>
          <div data-testid="variant">{result?.variant || 'none'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reason')).toHaveTextContent('targeting');
      expect(screen.getByTestId('variant')).toHaveTextContent('variant-a');
    });
  });

  it('should support refetch functionality', async () => {
    let callCount = 0;
    mockEvaluate.mockImplementation(async () => {
      callCount++;
      return {
        value: callCount > 1,
        flagKey: 'test-flag',
        reason: 'default',
        variant: null,
      };
    });

    const TestComponent = () => {
      const { value, refetch } = useFlag('test-flag');
      return (
        <div>
          <div data-testid="value">{value ? 'true' : 'false'}</div>
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
      expect(screen.getByTestId('value')).toHaveTextContent('false');
    });

    await act(async () => {
      getByText('Refetch').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('true');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(2);
  });

  it('should subscribe to realtime updates when realtime is true', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'default',
      variant: null,
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const mockUnsubscribe = jest.fn();
    mockSubscribe.mockReturnValue(mockUnsubscribe);

    const TestComponent = () => {
      useFlag('test-flag', { realtime: true });
      return <div>Test</div>;
    };

    const { unmount } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('test-flag', expect.any(Function));
    });

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should not subscribe to realtime updates when realtime is false', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'default',
      variant: null,
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const TestComponent = () => {
      useFlag('test-flag', { realtime: false });
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockEvaluate).toHaveBeenCalled();
    });

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should re-evaluate when flag update is received', async () => {
    let evaluationCount = 0;
    mockEvaluate.mockImplementation(async () => {
      evaluationCount++;
      return {
        value: evaluationCount > 1,
        flagKey: 'test-flag',
        reason: 'default',
        variant: null,
      };
    });

    let updateCallback: (() => void) | undefined;
    mockSubscribe.mockImplementation((flagKey, callback) => {
      updateCallback = callback;
      return jest.fn();
    });

    const TestComponent = () => {
      const { value } = useFlag('test-flag', { realtime: true });
      return <div data-testid="value">{value ? 'true' : 'false'}</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('false');
    });

    // Simulate flag update
    await act(async () => {
      updateCallback?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('true');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(2);
  });

  it('should subscribe to override changes', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'default',
      variant: null,
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const mockUnsubscribe = jest.fn();
    mockOnOverrideChange.mockReturnValue(mockUnsubscribe);

    const TestComponent = () => {
      useFlag('test-flag');
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

  it('should re-evaluate when override changes', async () => {
    let evaluationCount = 0;
    mockEvaluate.mockImplementation(async () => {
      evaluationCount++;
      return {
        value: evaluationCount > 1,
        flagKey: 'test-flag',
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
      const { value } = useFlag('test-flag');
      return <div data-testid="value">{value ? 'true' : 'false'}</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('false');
    });

    // Simulate override change
    await act(async () => {
      overrideCallback?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId('value')).toHaveTextContent('true');
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(2);
  });

  it('should not evaluate if client is not ready', () => {
    (FlagClient as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Not ready');
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    const TestComponent = () => {
      const { value, loading } = useFlag('test-flag', { defaultValue: false });
      return (
        <div>
          <div data-testid="value">{value ? 'true' : 'false'}</div>
          <div data-testid="loading">{loading ? 'loading' : 'done'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    expect(screen.getByTestId('value')).toHaveTextContent('false');
    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(mockEvaluate).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should handle context changes', async () => {
    const mockResult: FlagEvaluationResult = {
      value: true,
      flagKey: 'test-flag',
      reason: 'default',
      variant: null,
    };
    mockEvaluate.mockResolvedValue(mockResult);

    const TestComponent = ({ userId }: { userId: string }) => {
      useFlag('test-flag', { context: { user_id: userId } });
      return <div>Test</div>;
    };

    const { rerender } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent userId="user-1" />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockEvaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({
        user_id: 'user-1',
        attributes: {},
      }));
    });

    rerender(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent userId="user-2" />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockEvaluate).toHaveBeenCalledWith('test-flag', expect.objectContaining({
        user_id: 'user-2',
        attributes: {},
      }));
    });
  });
});
