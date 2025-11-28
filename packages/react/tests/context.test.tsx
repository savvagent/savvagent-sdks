import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { SavvagentProvider, useSavvagent } from '../src/context';
import { FlagClient } from '@savvagent/sdk';

// Mock the FlagClient
jest.mock('@savvagent/sdk', () => ({
  FlagClient: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    evaluate: jest.fn(),
    subscribe: jest.fn(),
    onOverrideChange: jest.fn(),
  })),
}));

describe('SavvagentProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize and provide client instance', async () => {
    const TestComponent = () => {
      const { client, isReady } = useSavvagent();
      return (
        <div>
          <div data-testid="is-ready">{isReady ? 'ready' : 'not-ready'}</div>
          <div data-testid="has-client">{client ? 'has-client' : 'no-client'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-ready')).toHaveTextContent('ready');
      expect(screen.getByTestId('has-client')).toHaveTextContent('has-client');
    });

    expect(FlagClient).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  it('should provide default context values', async () => {
    const TestComponent = () => {
      const { defaultContext } = useSavvagent();
      return (
        <div>
          <div data-testid="user-id">{defaultContext.user_id || 'none'}</div>
          <div data-testid="environment">{defaultContext.environment || 'none'}</div>
          <div data-testid="app-id">{defaultContext.application_id || 'none'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider
        config={{ apiKey: 'test-key' }}
        defaultContext={{
          userId: 'user-123',
          environment: 'production',
          applicationId: 'app-456',
        }}
      >
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-id')).toHaveTextContent('user-123');
      expect(screen.getByTestId('environment')).toHaveTextContent('production');
      expect(screen.getByTestId('app-id')).toHaveTextContent('app-456');
    });
  });

  it('should convert camelCase context keys to snake_case', async () => {
    const TestComponent = () => {
      const { defaultContext } = useSavvagent();
      return (
        <div>
          <div data-testid="org-id">{defaultContext.organization_id || 'none'}</div>
          <div data-testid="anon-id">{defaultContext.anonymous_id || 'none'}</div>
          <div data-testid="session-id">{defaultContext.session_id || 'none'}</div>
        </div>
      );
    };

    render(
      <SavvagentProvider
        config={{ apiKey: 'test-key' }}
        defaultContext={{
          organizationId: 'org-789',
          anonymousId: 'anon-abc',
          sessionId: 'session-xyz',
        }}
      >
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('org-id')).toHaveTextContent('org-789');
      expect(screen.getByTestId('anon-id')).toHaveTextContent('anon-abc');
      expect(screen.getByTestId('session-id')).toHaveTextContent('session-xyz');
    });
  });

  it('should include custom attributes in default context', async () => {
    const TestComponent = () => {
      const { defaultContext } = useSavvagent();
      return (
        <div data-testid="attributes">
          {JSON.stringify(defaultContext.attributes)}
        </div>
      );
    };

    render(
      <SavvagentProvider
        config={{ apiKey: 'test-key' }}
        defaultContext={{
          attributes: { plan: 'pro', beta: true },
        }}
      >
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('attributes')).toHaveTextContent(
        JSON.stringify({ plan: 'pro', beta: true })
      );
    });
  });

  it('should handle initialization errors', () => {
    const mockOnError = jest.fn();
    const mockError = new Error('Init failed');

    (FlagClient as jest.Mock).mockImplementationOnce(() => {
      throw mockError;
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    render(
      <SavvagentProvider config={{ apiKey: 'test-key', onError: mockOnError }}>
        <div>Test</div>
      </SavvagentProvider>
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Savvagent] Failed to initialize client:',
      mockError
    );
    expect(mockOnError).toHaveBeenCalledWith(mockError);

    consoleErrorSpy.mockRestore();
  });

  it('should cleanup client on unmount', async () => {
    const mockClose = jest.fn();
    (FlagClient as jest.Mock).mockImplementationOnce(() => ({
      close: mockClose,
      evaluate: jest.fn(),
      subscribe: jest.fn(),
      onOverrideChange: jest.fn(),
    }));

    const { unmount } = render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <div>Test</div>
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(FlagClient).toHaveBeenCalled();
    });

    unmount();

    expect(mockClose).toHaveBeenCalled();
  });

  it('should re-initialize when apiKey changes', async () => {
    const mockClose = jest.fn();
    (FlagClient as jest.Mock).mockImplementation(() => ({
      close: mockClose,
      evaluate: jest.fn(),
      subscribe: jest.fn(),
      onOverrideChange: jest.fn(),
    }));

    const { rerender } = render(
      <SavvagentProvider config={{ apiKey: 'test-key-1' }}>
        <div>Test</div>
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(FlagClient).toHaveBeenCalledWith({ apiKey: 'test-key-1' });
    });

    rerender(
      <SavvagentProvider config={{ apiKey: 'test-key-2' }}>
        <div>Test</div>
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
      expect(FlagClient).toHaveBeenCalledWith({ apiKey: 'test-key-2' });
    });
  });

  it('should re-initialize when baseUrl changes', async () => {
    const mockClose = jest.fn();
    (FlagClient as jest.Mock).mockImplementation(() => ({
      close: mockClose,
      evaluate: jest.fn(),
      subscribe: jest.fn(),
      onOverrideChange: jest.fn(),
    }));

    const { rerender } = render(
      <SavvagentProvider config={{ apiKey: 'test-key', baseUrl: 'https://api1.example.com' }}>
        <div>Test</div>
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(FlagClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseUrl: 'https://api1.example.com'
      });
    });

    rerender(
      <SavvagentProvider config={{ apiKey: 'test-key', baseUrl: 'https://api2.example.com' }}>
        <div>Test</div>
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
    });
  });
});

describe('useSavvagent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should provide default context when used outside provider', () => {
    // Note: Due to the default context value, useSavvagent doesn't actually throw
    // when used outside a provider. It returns the default context with null client.
    // This is actually a design consideration - it allows for graceful degradation.
    const TestComponent = () => {
      const { client, isReady } = useSavvagent();
      return (
        <div>
          <div data-testid="client">{client ? 'has-client' : 'no-client'}</div>
          <div data-testid="ready">{isReady ? 'ready' : 'not-ready'}</div>
        </div>
      );
    };

    render(<TestComponent />);

    expect(screen.getByTestId('client')).toHaveTextContent('no-client');
    expect(screen.getByTestId('ready')).toHaveTextContent('not-ready');
  });

  it('should provide context values within provider', async () => {
    const TestComponent = () => {
      const context = useSavvagent();
      return (
        <div>
          <div data-testid="has-client">{context.client ? 'yes' : 'no'}</div>
          <div data-testid="is-ready">{context.isReady ? 'yes' : 'no'}</div>
          <div data-testid="has-default-context">
            {context.defaultContext ? 'yes' : 'no'}
          </div>
        </div>
      );
    };

    render(
      <SavvagentProvider config={{ apiKey: 'test-key' }}>
        <TestComponent />
      </SavvagentProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('has-client')).toHaveTextContent('yes');
      expect(screen.getByTestId('is-ready')).toHaveTextContent('yes');
      expect(screen.getByTestId('has-default-context')).toHaveTextContent('yes');
    });
  });
});
