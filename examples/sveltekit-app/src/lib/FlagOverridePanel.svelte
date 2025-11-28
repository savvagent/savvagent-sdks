<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getSavvagent,
    createOverridesStore,
    createAllFlagsStore,
    type FlagDefinition,
  } from '@savvagent/svelte';

  let isOpen = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let flags = $state<FlagDefinition[]>([]);

  // Get client and create stores
  let client: ReturnType<typeof getSavvagent> | null = null;
  let overridesStore: ReturnType<typeof createOverridesStore> | null = null;
  let allFlagsStore: ReturnType<typeof createAllFlagsStore> | null = null;

  // Subscribe to stores
  let overrides = $state<Record<string, boolean>>({});
  let activeOverrideCount = $derived(Object.keys(overrides).length);

  onMount(() => {
    try {
      client = getSavvagent();
      overridesStore = createOverridesStore();
      allFlagsStore = createAllFlagsStore('development');

      // Subscribe to overrides
      const unsubOverrides = overridesStore.subscribe((value) => {
        overrides = value.overrides;
      });

      // Subscribe to all flags
      const unsubFlags = allFlagsStore.subscribe((value) => {
        flags = value.flags;
        loading = value.loading;
        if (value.error) {
          error = value.error.message;
        }
      });

      // Keyboard shortcut: Ctrl+Shift+F to toggle panel
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'F') {
          e.preventDefault();
          isOpen = !isOpen;
        }
      };
      window.addEventListener('keydown', handleKeyDown);

      return () => {
        unsubOverrides();
        unsubFlags();
        window.removeEventListener('keydown', handleKeyDown);
      };
    } catch (e) {
      // Client not initialized yet
      console.warn('[FlagOverridePanel] Client not initialized:', e);
    }
  });

  function handleSetOverride(flagKey: string, value: boolean) {
    overridesStore?.set(flagKey, value);
  }

  function handleClearOverride(flagKey: string) {
    overridesStore?.clear(flagKey);
  }

  function handleClearAllOverrides() {
    overridesStore?.clearAll();
  }

  function handleRefresh() {
    allFlagsStore?.refetch();
  }

  function isOverridden(flagKey: string): boolean {
    return overridesStore?.has(flagKey) ?? false;
  }

  function getEffectiveValue(flag: FlagDefinition): boolean {
    const override = overrides[flag.key];
    if (override !== undefined) {
      return override;
    }
    return flag.enabled;
  }
</script>

{#if !isOpen}
  <button
    onclick={() => (isOpen = true)}
    class="flag-panel-trigger"
    title="Open Flag Override Panel (Ctrl+Shift+F)"
  >
    <span class="flag-icon">&#9873;</span>
    {#if activeOverrideCount > 0}
      <span class="override-badge">{activeOverrideCount}</span>
    {/if}
  </button>
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="flag-panel-overlay" onclick={() => (isOpen = false)}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flag-panel" onclick={(e) => e.stopPropagation()}>
      <div class="flag-panel-header">
        <h3>Feature Flag Overrides</h3>
        <div class="flag-panel-actions">
          <button
            onclick={handleRefresh}
            class="flag-panel-btn flag-panel-btn-secondary"
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            onclick={handleClearAllOverrides}
            class="flag-panel-btn flag-panel-btn-secondary"
            disabled={activeOverrideCount === 0}
          >
            Clear All
          </button>
          <button
            onclick={() => (isOpen = false)}
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

      {#if error}
        <div class="flag-panel-error">{error}</div>
      {/if}

      {#if loading && flags.length === 0}
        <div class="flag-panel-loading">Loading flags...</div>
      {:else if flags.length === 0}
        <div class="flag-panel-empty">No flags found</div>
      {:else}
        <div class="flag-list">
          {#each flags as flag (flag.key)}
            {@const flagIsOverridden = isOverridden(flag.key)}
            {@const effectiveValue = getEffectiveValue(flag)}
            <div class="flag-item" class:flag-item-overridden={flagIsOverridden}>
              <div class="flag-info">
                <div class="flag-key">
                  {flag.key}
                  {#if flagIsOverridden}
                    <span class="override-indicator">OVERRIDDEN</span>
                  {/if}
                </div>
                <div class="flag-meta">
                  <span class="flag-scope flag-scope-{flag.scope}">
                    {flag.scope}
                  </span>
                  <span class="flag-server-value">
                    Server: {flag.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              </div>

              <div class="flag-controls">
                <button
                  onclick={() => handleSetOverride(flag.key, true)}
                  class="flag-toggle-btn"
                  class:active={effectiveValue && flagIsOverridden}
                  class:server={effectiveValue && !flagIsOverridden}
                >
                  ON
                </button>
                <button
                  onclick={() => handleSetOverride(flag.key, false)}
                  class="flag-toggle-btn"
                  class:active={!effectiveValue && flagIsOverridden}
                  class:server={!effectiveValue && !flagIsOverridden}
                >
                  OFF
                </button>
                {#if flagIsOverridden}
                  <button
                    onclick={() => handleClearOverride(flag.key)}
                    class="flag-clear-btn"
                    title="Use server value"
                  >
                    Reset
                  </button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="flag-panel-footer">
        <span class="override-count">
          {activeOverrideCount} override{activeOverrideCount !== 1 ? 's' : ''} active
        </span>
        <span class="flag-panel-note">
          Overrides persist across page reloads.
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Flag Override Panel Styles */
  .flag-panel-trigger {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #1e293b;
    color: white;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transition: transform 0.2s, background 0.2s;
    z-index: 1000;
  }

  .flag-panel-trigger:hover {
    transform: scale(1.1);
    background: #334155;
  }

  .flag-icon {
    font-size: 20px;
  }

  .override-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #ef4444;
    color: white;
    font-size: 11px;
    font-weight: bold;
    min-width: 18px;
    height: 18px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
  }

  .flag-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1001;
    padding: 20px;
  }

  .flag-panel {
    background: white;
    border-radius: 12px;
    width: 100%;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
  }

  .flag-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
  }

  .flag-panel-header h3 {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
  }

  .flag-panel-actions {
    display: flex;
    gap: 8px;
  }

  .flag-panel-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .flag-panel-btn-secondary {
    background: #f1f5f9;
    color: #475569;
  }

  .flag-panel-btn-secondary:hover:not(:disabled) {
    background: #e2e8f0;
  }

  .flag-panel-btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .flag-panel-btn-close {
    background: transparent;
    color: #64748b;
    font-size: 1.5rem;
    line-height: 1;
    padding: 4px 8px;
  }

  .flag-panel-btn-close:hover {
    background: #f1f5f9;
    color: #1e293b;
  }

  .flag-panel-hint {
    padding: 12px 20px;
    background: #f8fafc;
    color: #64748b;
    font-size: 0.8125rem;
    margin: 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .flag-panel-hint kbd {
    background: #e2e8f0;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.75rem;
  }

  .flag-panel-error {
    padding: 12px 20px;
    background: #fef2f2;
    color: #dc2626;
    font-size: 0.875rem;
  }

  .flag-panel-loading,
  .flag-panel-empty {
    padding: 40px 20px;
    text-align: center;
    color: #64748b;
  }

  .flag-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .flag-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.2s;
  }

  .flag-item:last-child {
    border-bottom: none;
  }

  .flag-item:hover {
    background: #f8fafc;
  }

  .flag-item-overridden {
    background: #fffbeb;
  }

  .flag-item-overridden:hover {
    background: #fef3c7;
  }

  .flag-info {
    flex: 1;
    min-width: 0;
  }

  .flag-key {
    font-weight: 500;
    color: #1e293b;
    font-size: 0.9375rem;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .override-indicator {
    background: #f59e0b;
    color: white;
    font-size: 0.625rem;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }

  .flag-meta {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
  }

  .flag-scope {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .flag-scope-application {
    background: #dbeafe;
    color: #1d4ed8;
  }

  .flag-scope-enterprise {
    background: #f3e8ff;
    color: #7c3aed;
  }

  .flag-server-value {
    font-size: 0.75rem;
    color: #64748b;
  }

  .flag-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .flag-toggle-btn {
    padding: 6px 12px;
    border: 1px solid #e5e7eb;
    background: white;
    color: #64748b;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .flag-toggle-btn:first-child {
    border-radius: 6px 0 0 6px;
  }

  .flag-toggle-btn:nth-child(2) {
    border-radius: 0 6px 6px 0;
    border-left: none;
  }

  .flag-toggle-btn:hover {
    background: #f8fafc;
  }

  .flag-toggle-btn.server {
    background: #f1f5f9;
    color: #475569;
  }

  .flag-toggle-btn.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: white;
  }

  .flag-clear-btn {
    margin-left: 8px;
    padding: 6px 10px;
    border: none;
    background: #f1f5f9;
    color: #64748b;
    font-size: 0.75rem;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .flag-clear-btn:hover {
    background: #e2e8f0;
    color: #475569;
  }

  .flag-panel-footer {
    padding: 12px 20px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border-radius: 0 0 12px 12px;
  }

  .override-count {
    font-size: 0.8125rem;
    font-weight: 500;
    color: #475569;
  }

  .flag-panel-note {
    font-size: 0.75rem;
    color: #94a3b8;
  }
</style>
