<script lang="ts">
  import { onMount } from 'svelte';
  import { createOverridesStore, getSavvagent } from '@savvagent/svelte';
  import type { FlagDefinition } from '@savvagent/sdk';

  let isOpen = false;
  let flags: FlagDefinition[] = [];
  let loading = false;
  let error: string | null = null;

  const client = getSavvagent();
  const overrides = createOverridesStore();

  async function fetchFlags(retries = 3, delay = 1000) {
    loading = true;
    error = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        flags = await client.getAllFlags('development');
        error = null;
        loading = false;
        return; // Success - exit the retry loop
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to fetch flags';
        console.warn(`[FlagOverridePanel] Attempt ${attempt}/${retries} failed:`, errorMessage);

        if (attempt === retries) {
          // Final attempt failed
          error = errorMessage;
          console.error('[FlagOverridePanel] All retry attempts failed');
          loading = false;
        } else {
          // Wait before retrying with exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
      }
    }
  }

  function togglePanel() {
    isOpen = !isOpen;
    if (isOpen) {
      fetchFlags();
    }
  }

  function openPanel() {
    isOpen = true;
    fetchFlags();
  }

  function closePanel() {
    isOpen = false;
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('flag-panel-overlay')) {
      closePanel();
    }
  }

  function setOverride(flagKey: string, value: boolean) {
    overrides.set(flagKey, value);
  }

  function clearOverride(flagKey: string) {
    overrides.clear(flagKey);
  }

  function clearAllOverrides() {
    overrides.clearAll();
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl/Cmd + Shift + F to toggle panel
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      togglePanel();
    }
    // Escape to close
    if (e.key === 'Escape' && isOpen) {
      closePanel();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<button class="flag-panel-trigger" on:click={togglePanel} title="Toggle Flag Overrides (Ctrl+Shift+F)">
  <span class="flag-icon">⚑</span>
  {#if $overrides.count > 0}
    <span class="override-badge">{$overrides.count}</span>
  {/if}
</button>

{#if isOpen}
  <div class="flag-panel-overlay" on:click={handleOverlayClick} role="presentation">
    <div class="flag-panel">
      <div class="flag-panel-header">
        <h3>Feature Flag Overrides</h3>
        <div class="flag-panel-actions">
          <button class="flag-panel-btn-secondary" on:click={fetchFlags} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button class="flag-panel-btn-secondary" on:click={clearAllOverrides}>
            Clear All
          </button>
          <button class="flag-panel-btn-close" on:click={closePanel}>
            ×
          </button>
        </div>
      </div>

      <div class="flag-panel-body">
        {#if loading && flags.length === 0}
          <p class="flag-loading">Loading flags...</p>
        {:else if error}
          <p class="flag-error">Error loading flags: {error}</p>
        {:else if flags.length === 0}
          <p class="flag-empty">No flags found</p>
        {:else}
          <div class="flag-list">
            {#each flags as flag (flag.key)}
              {@const flagOverride = $overrides.overrides[flag.key]}
              {@const flagIsOverridden = flag.key in $overrides.overrides}
              <div class="flag-item" class:flag-item-overridden={flagIsOverridden}>
                <div class="flag-info">
                  <div class="flag-key">
                    {flag.key}
                    {#if flagIsOverridden}
                      <span class="override-indicator">OVERRIDDEN</span>
                    {/if}
                  </div>
                  <div class="flag-controls">
                    <button
                      class="flag-toggle-btn"
                      class:flag-btn-active={flagOverride === true}
                      on:click={() => setOverride(flag.key, true)}
                    >
                      ON
                    </button>
                    <button
                      class="flag-toggle-btn"
                      class:flag-btn-active={flagOverride === false}
                      on:click={() => setOverride(flag.key, false)}
                    >
                      OFF
                    </button>
                    {#if flagIsOverridden}
                      <button class="flag-clear-btn" on:click={() => clearOverride(flag.key)}>
                        Clear
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="flag-panel-footer">
        <span class="override-count">
          {$overrides.count} override{$overrides.count !== 1 ? 's' : ''} active
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .flag-panel-trigger {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: #333;
    color: white;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    z-index: 1000;
  }

  .flag-panel-trigger:hover {
    background: #444;
  }

  .flag-icon {
    font-size: 20px;
  }

  .override-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    background: #e53935;
    color: white;
    font-size: 12px;
    font-weight: bold;
    padding: 2px 6px;
    border-radius: 10px;
    min-width: 18px;
    text-align: center;
  }

  .flag-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1001;
    display: flex;
    justify-content: flex-end;
  }

  .flag-panel {
    width: 400px;
    max-width: 100%;
    height: 100%;
    background: white;
    display: flex;
    flex-direction: column;
    box-shadow: -2px 0 10px rgba(0, 0, 0, 0.1);
  }

  .flag-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid #eee;
  }

  .flag-panel-header h3 {
    margin: 0;
    font-size: 18px;
  }

  .flag-panel-actions {
    display: flex;
    gap: 8px;
  }

  .flag-panel-btn-secondary {
    background: #f5f5f5;
    border: 1px solid #ddd;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  }

  .flag-panel-btn-secondary:hover {
    background: #eee;
  }

  .flag-panel-btn-secondary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .flag-panel-btn-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    padding: 0 8px;
    color: #666;
  }

  .flag-panel-btn-close:hover {
    color: #333;
  }

  .flag-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }

  .flag-loading,
  .flag-error,
  .flag-empty {
    text-align: center;
    color: #666;
    padding: 20px;
  }

  .flag-error {
    color: #e53935;
  }

  .flag-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .flag-item {
    padding: 12px;
    border: 1px solid #eee;
    border-radius: 8px;
    background: #fafafa;
  }

  .flag-item-overridden {
    border-color: #ff9800;
    background: #fff8e1;
  }

  .flag-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .flag-key {
    font-weight: 500;
    font-family: monospace;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .override-indicator {
    font-size: 10px;
    background: #ff9800;
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: bold;
  }

  .flag-controls {
    display: flex;
    gap: 8px;
  }

  .flag-toggle-btn {
    padding: 6px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: white;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }

  .flag-toggle-btn:hover {
    background: #f5f5f5;
  }

  .flag-btn-active {
    background: #4caf50;
    color: white;
    border-color: #4caf50;
  }

  .flag-btn-active:hover {
    background: #43a047;
  }

  .flag-clear-btn {
    padding: 6px 16px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #f5f5f5;
    color: #666;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }

  .flag-clear-btn:hover {
    background: #eee;
  }

  .flag-panel-footer {
    padding: 12px 16px;
    border-top: 1px solid #eee;
    background: #fafafa;
  }

  .override-count {
    font-size: 14px;
    color: #666;
  }
</style>
