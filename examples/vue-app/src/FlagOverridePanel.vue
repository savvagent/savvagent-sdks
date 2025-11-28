<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useSavvagent } from '@savvagent/vue';
import type { FlagDefinition } from '@savvagent/sdk';

const STORAGE_KEY = 'savvagent_local_overrides';

/**
 * Flag Override Panel
 * Developer tool for locally overriding feature flag values.
 * Per SDK Developer Guide: Client-side overrides for testing/debugging.
 *
 * This component uses the FlagClient's built-in override methods,
 * which are applied at the evaluation level (before cache/API).
 */

const { client, isReady } = useSavvagent();
const isOpen = ref(false);
const flags = ref<FlagDefinition[]>([]);
const overrides = ref<Record<string, boolean>>({});
const loading = ref(false);
const error = ref<string | null>(null);

// Load overrides from localStorage and apply to client on mount
onMounted(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsedOverrides = JSON.parse(stored) as Record<string, boolean>;
      // Apply stored overrides to the client
      client.setOverrides(parsedOverrides);
      overrides.value = parsedOverrides;
    }
  } catch (e) {
    console.warn('[FlagOverridePanel] Failed to load overrides:', e);
  }
});

// Subscribe to override changes from the client
onMounted(() => {
  const unsubscribe = client.onOverrideChange(() => {
    overrides.value = client.getOverrides();
  });

  onUnmounted(() => {
    unsubscribe();
  });
});

// Persist overrides to localStorage whenever they change
watch(overrides, (newOverrides) => {
  try {
    if (Object.keys(newOverrides).length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newOverrides));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.warn('[FlagOverridePanel] Failed to save overrides:', e);
  }
}, { deep: true });

// Keyboard shortcut: Ctrl+Shift+F to toggle panel
onMounted(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      isOpen.value = !isOpen.value;
    }
  };
  window.addEventListener('keydown', handleKeyDown);

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });
});

// Fetch all flags when panel opens
const fetchFlags = async () => {
  if (!isReady.value) return;

  loading.value = true;
  error.value = null;

  try {
    const allFlags = await client.getAllFlags('development');
    flags.value = allFlags;
  } catch (e) {
    error.value = 'Failed to fetch flags';
    console.error('[FlagOverridePanel] Error fetching flags:', e);
  } finally {
    loading.value = false;
  }
};

watch([isOpen, isReady], ([open, ready]) => {
  if (open && ready) {
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

// Check if a flag is overridden
const isOverridden = (flagKey: string): boolean => {
  return client?.hasOverride(flagKey) ?? false;
};

// Get effective value (override or server)
const getEffectiveValue = (flag: FlagDefinition): boolean => {
  const override = overrides.value[flag.key];
  if (override !== undefined) {
    return override;
  }
  return flag.enabled;
};

// Count active overrides
const activeOverrideCount = computed(() => Object.keys(overrides.value).length);

const openPanel = () => {
  isOpen.value = true;
};

const closePanel = () => {
  isOpen.value = false;
};
</script>

<template>
  <!-- Trigger button when panel is closed -->
  <button
    v-if="!isOpen"
    @click="openPanel"
    class="flag-panel-trigger"
    title="Open Flag Override Panel (Ctrl+Shift+F)"
  >
    <span class="flag-icon">&#9873;</span>
    <span v-if="activeOverrideCount > 0" class="override-badge">{{ activeOverrideCount }}</span>
  </button>

  <!-- Panel overlay when open -->
  <div v-if="isOpen" class="flag-panel-overlay" @click="closePanel">
    <div class="flag-panel" @click.stop>
      <div class="flag-panel-header">
        <h3>Feature Flag Overrides</h3>
        <div class="flag-panel-actions">
          <button
            @click="fetchFlags"
            class="flag-panel-btn flag-panel-btn-secondary"
            :disabled="loading"
          >
            {{ loading ? 'Loading...' : 'Refresh' }}
          </button>
          <button
            @click="handleClearAllOverrides"
            class="flag-panel-btn flag-panel-btn-secondary"
            :disabled="activeOverrideCount === 0"
          >
            Clear All
          </button>
          <button
            @click="closePanel"
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

      <div v-if="error" class="flag-panel-error">{{ error }}</div>

      <div v-if="loading && flags.length === 0" class="flag-panel-loading">
        Loading flags...
      </div>
      <div v-else-if="flags.length === 0" class="flag-panel-empty">
        No flags found
      </div>
      <div v-else class="flag-list">
        <div
          v-for="flag in flags"
          :key="flag.key"
          :class="['flag-item', { 'flag-item-overridden': isOverridden(flag.key) }]"
        >
          <div class="flag-info">
            <div class="flag-key">
              {{ flag.key }}
              <span v-if="isOverridden(flag.key)" class="override-indicator">OVERRIDDEN</span>
            </div>
            <div class="flag-meta">
              <span :class="['flag-scope', `flag-scope-${flag.scope}`]">
                {{ flag.scope }}
              </span>
              <span class="flag-server-value">
                Server: {{ flag.enabled ? 'ON' : 'OFF' }}
              </span>
            </div>
          </div>

          <div class="flag-controls">
            <button
              @click="handleSetOverride(flag.key, true)"
              :class="[
                'flag-toggle-btn',
                { 'active': getEffectiveValue(flag) && isOverridden(flag.key) },
                { 'server': getEffectiveValue(flag) && !isOverridden(flag.key) }
              ]"
            >
              ON
            </button>
            <button
              @click="handleSetOverride(flag.key, false)"
              :class="[
                'flag-toggle-btn',
                { 'active': !getEffectiveValue(flag) && isOverridden(flag.key) },
                { 'server': !getEffectiveValue(flag) && !isOverridden(flag.key) }
              ]"
            >
              OFF
            </button>
            <button
              v-if="isOverridden(flag.key)"
              @click="handleClearOverride(flag.key)"
              class="flag-clear-btn"
              title="Use server value"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div class="flag-panel-footer">
        <span class="override-count">
          {{ activeOverrideCount }} override{{ activeOverrideCount !== 1 ? 's' : '' }} active
        </span>
        <span class="flag-panel-note">
          Overrides persist across page reloads.
        </span>
      </div>
    </div>
  </div>
</template>
