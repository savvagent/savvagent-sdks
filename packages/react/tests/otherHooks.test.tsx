import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SavvagentProvider } from '../src/context';
import { useWithFlag, useUser, useTrackError } from '../src/hooks';
import { FlagClient } from '@savvagent/sdk';

// Mock the FlagClient
const mockWithFlag = jest.fn();
const mockSetUserId = jest.fn();
const mockGetUserId = jest.fn();
const mockGetAnonymousId = jest.fn();
const mockSetAnonymousId = jest.fn();
const mockTrackError = jest.fn();
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
    withFlag: mockWithFlag,
    setUserId: mockSetUserId,
    getUserId: mockGetUserId,
    getAnonymousId: mockGetAnonymousId,
    setAnonymousId: mockSetAnonymousId,
    trackError: mockTrackError,
  })),
}));

describe('useWithFlag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithFlag.mockResolvedValue(undefined);
  });

  it('should execute callback with flag', async () => {
    const callback = jest.fn();

    const TestComponent = () => {
      useWithFlag('test-flag', callback);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockWithFlag).toHaveBeenCalledWith('test-flag', callback, undefined);
    });
  });

  it('should pass context to withFlag', async () => {
    const callback = jest.fn();
    const context = { user_id: 'user-123' };

    const TestComponent = () => {
      useWithFlag('test-flag', callback, { context });
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockWithFlag).toHaveBeenCalledWith('test-flag', callback, context);
    });
  });

  it('should handle callback errors', async () => {
    const mockError = new Error('Callback failed');
    mockWithFlag.mockRejectedValue(mockError);
    const onError = jest.fn();
    const callback = jest.fn();

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    const TestComponent = () => {
      useWithFlag('test-flag', callback, { onError });
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Savvagent] Error in withFlag callback for test-flag:',
        mockError
      );
      expect(onError).toHaveBeenCalledWith(mockError);
    });

    consoleErrorSpy.mockRestore();
  });

  it('should not execute if client is not ready', async () => {
    (FlagClient as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Not ready');
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const callback = jest.fn();

    const TestComponent = () => {
      useWithFlag('test-flag', callback);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockWithFlag).not.toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });
});

describe('useUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserId.mockReturnValue('user-123');
    mockGetAnonymousId.mockReturnValue('anon-456');
  });

  it('should set user ID', async () => {
    const TestComponent = () => {
      const { setUserId } = useUser();
      useEffect(() => {
        setUserId('new-user-id');
      }, [setUserId]);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockSetUserId).toHaveBeenCalledWith('new-user-id');
    });
  });

  it('should get user ID', async () => {
    const TestComponent = () => {
      const { getUserId } = useUser();
      const userId = getUserId();
      return <div data-testid="user-id">{userId}</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-id')).toHaveTextContent('user-123');
      expect(mockGetUserId).toHaveBeenCalled();
    });
  });

  it('should return null when no user ID is set', async () => {
    mockGetUserId.mockReturnValue(null);

    const TestComponent = () => {
      const { getUserId } = useUser();
      const userId = getUserId();
      return <div data-testid="user-id">{userId || 'none'}</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    });
  });

  it('should get anonymous ID', async () => {
    const TestComponent = () => {
      const { getAnonymousId } = useUser();
      const anonId = getAnonymousId();
      return <div data-testid="anon-id">{anonId}</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('anon-id')).toHaveTextContent('anon-456');
      expect(mockGetAnonymousId).toHaveBeenCalled();
    });
  });

  it('should set anonymous ID', async () => {
    const TestComponent = () => {
      const { setAnonymousId } = useUser();
      useEffect(() => {
        setAnonymousId('new-anon-id');
      }, [setAnonymousId]);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockSetAnonymousId).toHaveBeenCalledWith('new-anon-id');
    });
  });

  it('should clear user ID', async () => {
    const TestComponent = () => {
      const { setUserId } = useUser();
      useEffect(() => {
        setUserId(null);
      }, [setUserId]);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockSetUserId).toHaveBeenCalledWith(null);
    });
  });

  it('should handle null client gracefully', () => {
    (FlagClient as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Not ready');
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    const TestComponent = () => {
      const { setUserId, getUserId, getAnonymousId, setAnonymousId } = useUser();

      // Call setters in useEffect to avoid infinite re-render loop
      useEffect(() => {
        // These should not throw when client is null
        setUserId('user-id');
        setAnonymousId('anon-id');
      }, [setUserId, setAnonymousId]);

      const userId = getUserId();
      const anonId = getAnonymousId();

      return (
        <div>
          <div data-testid="user-id">{userId || 'none'}</div>
          <div data-testid="anon-id">{anonId || 'none'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    expect(screen.getByTestId('anon-id')).toHaveTextContent('none');

    consoleErrorSpy.mockRestore();
  });
});

describe('useTrackError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset FlagClient mock to default implementation (undo any mockImplementationOnce)
    (FlagClient as jest.Mock).mockImplementation(() => ({
      close: mockClose,
      evaluate: mockEvaluate,
      subscribe: mockSubscribe,
      onOverrideChange: mockOnOverrideChange,
      withFlag: mockWithFlag,
      setUserId: mockSetUserId,
      getUserId: mockGetUserId,
      getAnonymousId: mockGetAnonymousId,
      setAnonymousId: mockSetAnonymousId,
      trackError: mockTrackError,
    }));
  });

  it('should track error with flag key', async () => {
    const error = new Error('Test error');

    const TestComponent = () => {
      const trackError = useTrackError('test-flag');
      useEffect(() => {
        trackError(error);
      }, [trackError]);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockTrackError).toHaveBeenCalledWith('test-flag', error, undefined);
    });
  });

  it('should track error with context', async () => {
    const error = new Error('Test error');
    const context = { user_id: 'user-123' };

    const TestComponent = () => {
      const trackError = useTrackError('test-flag', context);
      useEffect(() => {
        trackError(error);
      }, [trackError]);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockTrackError).toHaveBeenCalledWith('test-flag', error, context);
    });
  });

  it('should handle null client gracefully', () => {
    (FlagClient as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Not ready');
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    const error = new Error('Test error');

    const TestComponent = () => {
      const trackError = useTrackError('test-flag');
      useEffect(() => {
        // This should not throw
        trackError(error);
      }, [trackError]);
      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    expect(mockTrackError).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should create stable tracking function', async () => {
    const error1 = new Error('Error 1');
    const error2 = new Error('Error 2');

    const TestComponent = () => {
      const trackError = useTrackError('test-flag');

      useEffect(() => {
        trackError(error1);
        trackError(error2);
      }, [trackError]);

      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockTrackError).toHaveBeenCalledTimes(2);
      expect(mockTrackError).toHaveBeenCalledWith('test-flag', error1, undefined);
      expect(mockTrackError).toHaveBeenCalledWith('test-flag', error2, undefined);
    });
  });

  it('should support different flag keys', async () => {
    const error = new Error('Test error');

    const TestComponent = () => {
      const trackErrorA = useTrackError('flag-a');
      const trackErrorB = useTrackError('flag-b');

      useEffect(() => {
        trackErrorA(error);
        trackErrorB(error);
      }, [trackErrorA, trackErrorB]);

      return <div>Test</div>;
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockTrackError).toHaveBeenCalledWith('flag-a', error, undefined);
      expect(mockTrackError).toHaveBeenCalledWith('flag-b', error, undefined);
    });
  });
});
