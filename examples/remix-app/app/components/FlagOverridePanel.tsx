import { useState, useEffect, useCallback } from 'react';
import { useSavvagent } from '@savvagent/remix';
import type { FlagDefinition } from '@savvagent/remix';

const STORAGE_KEY = 'savvagent_local_overrides';

/**
 * Flag Override Panel
 * Developer tool for locally overriding feature flag values.
 * Per SDK Developer Guide: Client-side overrides for testing/debugging.
 *
 * This component uses the FlagClient's built-in override methods,
 * which are applied at the evaluation level (before cache/API).
 */
export function FlagOverridePanel() {
  const { client, isReady } = useSavvagent();
  const [isOpen, setIsOpen] = useState(false);
  const [flags, setFlags] = useState<FlagDefinition[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load overrides from localStorage and apply to client on mount
  useEffect(() => {
    if (!client) return;

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedOverrides = JSON.parse(stored) as Record<string, boolean>;
        // Apply stored overrides to the client
        client.setOverrides(parsedOverrides);
        setOverrides(parsedOverrides);
      }
    } catch (e) {
      console.warn('[FlagOverridePanel] Failed to load overrides:', e);
    }
  }, [client]);

  // Subscribe to override changes from the client
  useEffect(() => {
    if (!client) return;

    const unsubscribe = client.onOverrideChange(() => {
      setOverrides(client.getOverrides());
    });

    return unsubscribe;
  }, [client]);

  // Persist overrides to localStorage whenever they change
  useEffect(() => {
    try {
      if (Object.keys(overrides).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[FlagOverridePanel] Failed to save overrides:', e);
    }
  }, [overrides]);

  // Keyboard shortcut: Ctrl+Shift+F to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch all flags when panel opens
  const fetchFlags = useCallback(async () => {
    if (!client || !isReady) return;

    setLoading(true);
    setError(null);

    try {
      const allFlags = await client.getAllFlags('development');
      setFlags(allFlags);
    } catch (e) {
      setError('Failed to fetch flags');
      console.error('[FlagOverridePanel] Error fetching flags:', e);
    } finally {
      setLoading(false);
    }
  }, [client, isReady]);

  useEffect(() => {
    if (isOpen && isReady) {
      fetchFlags();
    }
  }, [isOpen, isReady, fetchFlags]);

  // Set override using client method
  const handleSetOverride = (flagKey: string, value: boolean) => {
    if (!client) return;
    client.setOverride(flagKey, value);
  };

  // Clear override using client method
  const handleClearOverride = (flagKey: string) => {
    if (!client) return;
    client.clearOverride(flagKey);
  };

  // Clear all overrides
  const handleClearAllOverrides = () => {
    if (!client) return;
    client.clearAllOverrides();
  };

  // Check if a flag is overridden
  const isOverridden = (flagKey: string): boolean => {
    return client?.hasOverride(flagKey) ?? false;
  };

  // Get effective value (override or server)
  const getEffectiveValue = (flag: FlagDefinition): boolean => {
    const override = overrides[flag.key];
    if (override !== undefined) {
      return override;
    }
    return flag.enabled;
  };

  // Count active overrides
  const activeOverrideCount = Object.keys(overrides).length;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flag-panel-trigger"
        title="Open Flag Override Panel (Ctrl+Shift+F)"
      >
        <span className="flag-icon">&#9873;</span>
        {activeOverrideCount > 0 && (
          <span className="override-badge">{activeOverrideCount}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flag-panel-overlay" onClick={() => setIsOpen(false)}>
      <div className="flag-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flag-panel-header">
          <h3>Feature Flag Overrides</h3>
          <div className="flag-panel-actions">
            <button
              onClick={fetchFlags}
              className="flag-panel-btn flag-panel-btn-secondary"
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button
              onClick={handleClearAllOverrides}
              className="flag-panel-btn flag-panel-btn-secondary"
              disabled={activeOverrideCount === 0}
            >
              Clear All
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="flag-panel-btn flag-panel-btn-close"
            >
              &times;
            </button>
          </div>
        </div>

        <p className="flag-panel-hint">
          Toggle flags locally for testing. Changes apply immediately.
          Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to toggle panel.
        </p>

        {error && <div className="flag-panel-error">{error}</div>}

        {loading && flags.length === 0 ? (
          <div className="flag-panel-loading">Loading flags...</div>
        ) : flags.length === 0 ? (
          <div className="flag-panel-empty">No flags found</div>
        ) : (
          <div className="flag-list">
            {flags.map((flag) => {
              const flagIsOverridden = isOverridden(flag.key);
              const effectiveValue = getEffectiveValue(flag);

              return (
                <div
                  key={flag.key}
                  className={`flag-item ${flagIsOverridden ? 'flag-item-overridden' : ''}`}
                >
                  <div className="flag-info">
                    <div className="flag-key">
                      {flag.key}
                      {flagIsOverridden && <span className="override-indicator">OVERRIDDEN</span>}
                    </div>
                    <div className="flag-meta">
                      <span className={`flag-scope flag-scope-${flag.scope}`}>
                        {flag.scope}
                      </span>
                      <span className="flag-server-value">
                        Server: {flag.enabled ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  </div>

                  <div className="flag-controls">
                    <button
                      onClick={() => handleSetOverride(flag.key, true)}
                      className={`flag-toggle-btn ${effectiveValue && flagIsOverridden ? 'active' : ''} ${effectiveValue && !flagIsOverridden ? 'server' : ''}`}
                    >
                      ON
                    </button>
                    <button
                      onClick={() => handleSetOverride(flag.key, false)}
                      className={`flag-toggle-btn ${!effectiveValue && flagIsOverridden ? 'active' : ''} ${!effectiveValue && !flagIsOverridden ? 'server' : ''}`}
                    >
                      OFF
                    </button>
                    {flagIsOverridden && (
                      <button
                        onClick={() => handleClearOverride(flag.key)}
                        className="flag-clear-btn"
                        title="Use server value"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flag-panel-footer">
          <span className="override-count">
            {activeOverrideCount} override{activeOverrideCount !== 1 ? 's' : ''} active
          </span>
          <span className="flag-panel-note">
            Overrides persist across page reloads.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to use local overrides with automatic re-render on changes.
 * This hook subscribes to the client's override changes.
 */
export function useLocalOverrides(): Record<string, boolean> {
  const { client } = useSavvagent();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!client) return;

    // Get initial overrides
    setOverrides(client.getOverrides());

    // Subscribe to changes
    const unsubscribe = client.onOverrideChange(() => {
      setOverrides(client.getOverrides());
    });

    return unsubscribe;
  }, [client]);

  return overrides;
}

/**
 * Get the effective flag value considering local overrides.
 * Note: This is only needed if you're manually managing values.
 * The useFlag/useFlags hooks automatically respect overrides.
 */
export function getOverriddenValue(
  flagKey: string,
  serverValue: boolean,
  overrides: Record<string, boolean>
): boolean {
  const override = overrides[flagKey];
  if (override !== undefined) {
    return override;
  }
  return serverValue;
}
