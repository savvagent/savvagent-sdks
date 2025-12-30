import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import { useSavvagent } from '@savvagent/solid';
import type { FlagDefinition } from '@savvagent/solid';

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
  const [isOpen, setIsOpen] = createSignal(false);
  const [flags, setFlags] = createSignal<FlagDefinition[]>([]);
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({});
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Load overrides from localStorage and apply to client on mount
  createEffect(() => {
    if (!isReady()) return;

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
  });

  // Subscribe to override changes from the client
  createEffect(() => {
    if (!isReady()) return;

    const unsubscribe = client.onOverrideChange(() => {
      setOverrides(client.getOverrides());
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  // Persist overrides to localStorage whenever they change
  createEffect(() => {
    const currentOverrides = overrides();
    try {
      if (Object.keys(currentOverrides).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentOverrides));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[FlagOverridePanel] Failed to save overrides:', e);
    }
  });

  // Keyboard shortcut: Ctrl+Shift+F to toggle panel
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  // Fetch all flags when panel opens
  const fetchFlags = async () => {
    if (!isReady()) return;

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
  };

  createEffect(() => {
    if (isOpen() && isReady()) {
      fetchFlags();
    }
  });

  // Set override using client method
  const handleSetOverride = (flagKey: string, value: boolean) => {
    client.setOverride(flagKey, value);
  };

  // Clear override using client method
  const handleClearOverride = (flagKey: string) => {
    client.clearOverride(flagKey);
  };

  // Clear all overrides
  const handleClearAllOverrides = () => {
    client.clearAllOverrides();
  };

  // Check if a flag is overridden - use reactive overrides() signal
  const isOverridden = (flagKey: string): boolean => {
    return flagKey in overrides();
  };

  // Get effective value (override or server)
  const getEffectiveValue = (flag: FlagDefinition): boolean => {
    const override = overrides()[flag.key];
    if (override !== undefined) {
      return override;
    }
    return flag.enabled;
  };

  // Count active overrides
  const activeOverrideCount = () => Object.keys(overrides()).length;

  return (
    <>
      <Show when={!isOpen()}>
        <button
          onClick={() => setIsOpen(true)}
          class="flag-panel-trigger"
          title="Open Flag Override Panel (Ctrl+Shift+F)"
        >
          <span class="flag-icon">&#9873;</span>
          <Show when={activeOverrideCount() > 0}>
            <span class="override-badge">{activeOverrideCount()}</span>
          </Show>
        </button>
      </Show>

      <Show when={isOpen()}>
        <div class="flag-panel-overlay" onClick={() => setIsOpen(false)}>
          <div class="flag-panel" onClick={(e) => e.stopPropagation()}>
            <div class="flag-panel-header">
              <h3>Feature Flag Overrides</h3>
              <div class="flag-panel-actions">
                <button
                  onClick={fetchFlags}
                  class="flag-panel-btn flag-panel-btn-secondary"
                  disabled={loading()}
                >
                  {loading() ? 'Loading...' : 'Refresh'}
                </button>
                <button
                  onClick={handleClearAllOverrides}
                  class="flag-panel-btn flag-panel-btn-secondary"
                  disabled={activeOverrideCount() === 0}
                >
                  Clear All
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  class="flag-panel-btn flag-panel-btn-close"
                >
                  &times;
                </button>
              </div>
            </div>

            <p class="flag-panel-hint">
              Toggle flags locally for testing. Changes apply immediately.
              Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to toggle panel.
            </p>

            <Show when={error()}>
              <div class="flag-panel-error">{error()}</div>
            </Show>

            <Show
              when={!loading() || flags().length > 0}
              fallback={<div class="flag-panel-loading">Loading flags...</div>}
            >
              <Show
                when={flags().length > 0}
                fallback={<div class="flag-panel-empty">No flags found</div>}
              >
                <div class="flag-list">
                  <For each={flags()}>
                    {(flag) => {
                      const flagIsOverridden = () => isOverridden(flag.key);
                      const effectiveValue = () => getEffectiveValue(flag);

                      return (
                        <div
                          class={`flag-item ${flagIsOverridden() ? 'flag-item-overridden' : ''}`}
                        >
                          <div class="flag-info">
                            <div class="flag-key">
                              {flag.key}
                              <Show when={flagIsOverridden()}>
                                <span class="override-indicator">OVERRIDDEN</span>
                              </Show>
                            </div>
                            <div class="flag-meta">
                              <span class={`flag-scope flag-scope-${flag.scope}`}>
                                {flag.scope}
                              </span>
                              <span class="flag-server-value">
                                Server: {flag.enabled ? 'ON' : 'OFF'}
                              </span>
                            </div>
                          </div>

                          <div class="flag-controls">
                            <button
                              onClick={() => handleSetOverride(flag.key, true)}
                              class={`flag-toggle-btn ${effectiveValue() && flagIsOverridden() ? 'active' : ''} ${effectiveValue() && !flagIsOverridden() ? 'server' : ''}`}
                            >
                              ON
                            </button>
                            <button
                              onClick={() => handleSetOverride(flag.key, false)}
                              class={`flag-toggle-btn ${!effectiveValue() && flagIsOverridden() ? 'active' : ''} ${!effectiveValue() && !flagIsOverridden() ? 'server' : ''}`}
                            >
                              OFF
                            </button>
                            <Show when={flagIsOverridden()}>
                              <button
                                onClick={() => handleClearOverride(flag.key)}
                                class="flag-clear-btn"
                                title="Use server value"
                              >
                                Reset
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Show>

            <div class="flag-panel-footer">
              <span class="override-count">
                {activeOverrideCount()} override{activeOverrideCount() !== 1 ? 's' : ''} active
              </span>
              <span class="flag-panel-note">
                Overrides persist across page reloads.
              </span>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}

/**
 * Create a signal for local overrides with automatic updates on changes.
 * This subscribes to the client's override changes.
 */
export function createLocalOverrides() {
  const { client, isReady } = useSavvagent();
  const [overrides, setOverrides] = createSignal<Record<string, boolean>>({});

  createEffect(() => {
    if (!isReady()) return;

    // Get initial overrides
    setOverrides(client.getOverrides());

    // Subscribe to changes
    const unsubscribe = client.onOverrideChange(() => {
      setOverrides(client.getOverrides());
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  return overrides;
}

/**
 * Get the effective flag value considering local overrides.
 * Note: This is only needed if you're manually managing values.
 * The createFlag/createFlags functions automatically respect overrides.
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
