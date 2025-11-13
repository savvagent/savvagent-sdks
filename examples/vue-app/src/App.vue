<script setup lang="ts">
import { computed } from 'vue';
import { useFeatureFlag } from '@savvagent/vue';

const { isEnabled: newFeatureEnabled, loading: loading1 } = useFeatureFlag(
  'new-feature',
  {
    userId: 'user-123',
    attributes: {
      email: 'user@example.com',
      plan: 'pro',
    },
  }
);

const { isEnabled: betaFeatureEnabled, loading: loading2 } = useFeatureFlag(
  'beta-feature',
  {
    userId: 'user-123',
  }
);

const loading = computed(() => loading1.value || loading2.value);
</script>

<template>
  <div class="container">
    <h1>Savvagent Vue Example</h1>

    <p v-if="loading" class="loading">Loading feature flags...</p>

    <div v-else>
      <div class="feature-card">
        <h2>New Feature</h2>
        <p>
          Status:
          <span :class="['status', newFeatureEnabled ? 'enabled' : 'disabled']">
            {{ newFeatureEnabled ? 'Enabled' : 'Disabled' }}
          </span>
        </p>
      </div>

      <div class="feature-card">
        <h2>Beta Feature</h2>
        <p>
          Status:
          <span :class="['status', betaFeatureEnabled ? 'enabled' : 'disabled']">
            {{ betaFeatureEnabled ? 'Enabled' : 'Disabled' }}
          </span>
        </p>
      </div>

      <div v-if="newFeatureEnabled" class="alert alert-success">
        <strong>New Feature Enabled!</strong>
        <p>This feature is enabled for you based on your user attributes.</p>
      </div>
    </div>
  </div>
</template>
