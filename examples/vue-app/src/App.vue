<script setup lang="ts">
import { useFlags, useUser, useTrackError, useSavvagent } from '@savvagent/vue';
import FlagOverridePanel from './FlagOverridePanel.vue';

/**
 * Feature Demo Component
 * Demonstrates best practices for using Savvagent Vue SDK
 *
 * Uses the useFlags composable for optimal performance - evaluates multiple flags
 * with a single state update, preventing unnecessary re-renders.
 */

const { client } = useSavvagent();

// Per SDK Developer Guide: Use useFlags for multiple flags in the same component
// This is more performant than multiple useFlag calls as it:
// 1. Uses a single reactive object for atomic updates
// 2. Evaluates all flags in parallel
// 3. Only triggers one re-render when any flag changes
// 4. Automatically respects local overrides set via client.setOverride()
const { values, loading, results } = useFlags(
  ['new-feature', 'beta-feature', 'enterprise-one'],
  {
    defaultValues: {
      'new-feature': false,
      'beta-feature': false,
      'enterprise-one': false,
    },
    realtime: true, // Enable real-time updates for all flags
  }
);

// Hook for error tracking - per SDK Developer Guide telemetry
const trackError = useTrackError('new-feature');

// Hook for user management
const { setUserId, getUserId } = useUser();

// Example error handler demonstrating error tracking
const handleRiskyAction = async () => {
  try {
    // Simulated action that might fail
    throw new Error('Example error for demonstration');
  } catch (error) {
    // Track errors for AI-powered correlation
    trackError(error as Error);
    console.error('Action failed:', error);
  }
};

// User management handlers
const setRandomUserId = () => {
  setUserId('user-' + Date.now());
};

const clearUserId = () => {
  setUserId(null);
};

// Check if flags are overridden (for UI indication)
const isOverridden = (flagKey: string): boolean => {
  return client?.hasOverride(flagKey) ?? false;
};
</script>

<template>
  <div class="container">
    <h1>Savvagent Vue Example</h1>
    <p class="subtitle">SDK Developer Guide Best Practices Demo</p>

    <p v-if="loading" class="loading">Loading feature flags...</p>

    <div v-else>
      <div
        :class="['feature-card', { 'feature-card-overridden': isOverridden('new-feature') }]"
      >
        <h2>
          New Feature
          <span v-if="isOverridden('new-feature')" class="override-badge-inline">LOCAL OVERRIDE</span>
        </h2>
        <p>
          Status:
          <span :class="['status', values['new-feature'] ? 'enabled' : 'disabled']">
            {{ values['new-feature'] ? 'Enabled' : 'Disabled' }}
          </span>
        </p>
        <p v-if="isOverridden('new-feature')" class="server-value">
          Server value: {{ values['new-feature'] ? 'Enabled' : 'Disabled' }}
        </p>
        <p v-if="results['new-feature']?.metadata?.variation" class="variation">
          Variation: {{ results['new-feature'].metadata.variation }}
        </p>
        <p v-if="results['new-feature']?.metadata?.configuration" class="config">
          Config: <code>{{ JSON.stringify(results['new-feature'].metadata.configuration) }}</code>
        </p>
      </div>

      <div
        :class="['feature-card', { 'feature-card-overridden': isOverridden('beta-feature') }]"
      >
        <h2>
          Beta Feature
          <span v-if="isOverridden('beta-feature')" class="override-badge-inline">LOCAL OVERRIDE</span>
        </h2>
        <p>
          Status:
          <span :class="['status', values['beta-feature'] ? 'enabled' : 'disabled']">
            {{ values['beta-feature'] ? 'Enabled' : 'Disabled' }}
          </span>
        </p>
        <p v-if="isOverridden('beta-feature')" class="server-value">
          Server value: {{ values['beta-feature'] ? 'Enabled' : 'Disabled' }}
        </p>
        <p v-if="results['beta-feature']?.metadata?.variation" class="variation">
          Variation: {{ results['beta-feature'].metadata.variation }}
        </p>
      </div>

      <div
        :class="['feature-card', { 'feature-card-overridden': isOverridden('enterprise-one') }]"
      >
        <h2>
          Enterprise One
          <span v-if="isOverridden('enterprise-one')" class="override-badge-inline">LOCAL OVERRIDE</span>
        </h2>
        <p>
          Status:
          <span :class="['status', values['enterprise-one'] ? 'enabled' : 'disabled']">
            {{ values['enterprise-one'] ? 'Enabled' : 'Disabled' }}
          </span>
        </p>
        <p v-if="isOverridden('enterprise-one')" class="server-value">
          Server value: {{ values['enterprise-one'] ? 'Enabled' : 'Disabled' }}
        </p>
        <p v-if="results['enterprise-one']?.metadata?.variation" class="variation">
          Variation: {{ results['enterprise-one'].metadata.variation }}
        </p>
        <p v-if="results['enterprise-one']?.metadata?.configuration" class="config">
          Config: <code>{{ JSON.stringify(results['enterprise-one'].metadata.configuration) }}</code>
        </p>
      </div>

      <div v-if="values['new-feature']" class="alert alert-success">
        <strong>New Feature Enabled!</strong>
        <p>This feature is enabled for you based on your user attributes.</p>
        <button @click="handleRiskyAction" class="btn">
          Test Error Tracking
        </button>
      </div>

      <div class="user-section">
        <h3>User Management</h3>
        <p>Current User ID: <code>{{ getUserId() || 'Not set' }}</code></p>
        <button @click="setRandomUserId" class="btn">
          Set Random User ID
        </button>
        <button @click="clearUserId" class="btn btn-secondary">
          Clear User ID
        </button>
      </div>
    </div>
  </div>

  <FlagOverridePanel />
</template>
