'use client';

import { useFlags, useUser, useTrackError, useSavvagent } from '@savvagent/nextjs/client';

/**
 * Feature Demo Component
 * Demonstrates best practices for using Savvagent Next.js SDK
 *
 * Uses the useFlags hook for optimal performance - evaluates multiple flags
 * with a single state update, preventing unnecessary re-renders.
 */
export function FeatureDemo() {
  const { client } = useSavvagent();

  // Per SDK Developer Guide: Use useFlags for multiple flags in the same component
  // This is more performant than multiple useFlag calls as it:
  // 1. Uses a single state object for atomic updates
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

  // Flag values now automatically include overrides (applied in client.evaluate)
  const newFeatureEnabled = values['new-feature'];
  const betaFeatureEnabled = values['beta-feature'];
  const enterpriseOneEnabled = values['enterprise-one'];

  // Check if flags are overridden (for UI indication)
  const isNewFeatureOverridden = client?.hasOverride('new-feature') ?? false;
  const isBetaFeatureOverridden = client?.hasOverride('beta-feature') ?? false;
  const isEnterpriseOneOverridden = client?.hasOverride('enterprise-one') ?? false;

  // Extract results for metadata access
  const result1 = results['new-feature'];
  const result2 = results['beta-feature'];
  const result3 = results['enterprise-one'];

  // Hook for error tracking - per SDK Developer Guide telemetry
  const trackError = useTrackError('new-feature');

  // Hook for user management - userId is reactive state
  const { userId, setUserId } = useUser();

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

  return (
    <div className="container">
      <h1>Savvagent Next.js Example</h1>
      <p className="subtitle">SDK Developer Guide Best Practices Demo</p>

      {loading ? (
        <p className="loading">Loading feature flags...</p>
      ) : (
        <div>
          <div className={`feature-card ${isNewFeatureOverridden ? 'feature-card-overridden' : ''}`}>
            <h2>
              New Feature
              {isNewFeatureOverridden && <span className="override-badge-inline">LOCAL OVERRIDE</span>}
            </h2>
            <p>
              Status:
              <span className={`status ${newFeatureEnabled ? 'enabled' : 'disabled'}`}>
                {newFeatureEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            {isNewFeatureOverridden && (
              <p className="server-value">Server value: {values['new-feature'] ? 'Enabled' : 'Disabled'}</p>
            )}
            {result1?.metadata?.variation && (
              <p className="variation">Variation: {result1.metadata.variation}</p>
            )}
            {result1?.metadata?.configuration && (
              <p className="config">
                Config: <code>{JSON.stringify(result1.metadata.configuration)}</code>
              </p>
            )}
          </div>

          <div className={`feature-card ${isBetaFeatureOverridden ? 'feature-card-overridden' : ''}`}>
            <h2>
              Beta Feature
              {isBetaFeatureOverridden && <span className="override-badge-inline">LOCAL OVERRIDE</span>}
            </h2>
            <p>
              Status:
              <span className={`status ${betaFeatureEnabled ? 'enabled' : 'disabled'}`}>
                {betaFeatureEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            {isBetaFeatureOverridden && (
              <p className="server-value">Server value: {values['beta-feature'] ? 'Enabled' : 'Disabled'}</p>
            )}
            {result2?.metadata?.variation && (
              <p className="variation">Variation: {result2.metadata.variation}</p>
            )}
          </div>

          <div className={`feature-card ${isEnterpriseOneOverridden ? 'feature-card-overridden' : ''}`}>
            <h2>
              Enterprise One
              {isEnterpriseOneOverridden && <span className="override-badge-inline">LOCAL OVERRIDE</span>}
            </h2>
            <p>
              Status:
              <span className={`status ${enterpriseOneEnabled ? 'enabled' : 'disabled'}`}>
                {enterpriseOneEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
            {isEnterpriseOneOverridden && (
              <p className="server-value">Server value: {values['enterprise-one'] ? 'Enabled' : 'Disabled'}</p>
            )}
            {result3?.metadata?.variation && (
              <p className="variation">Variation: {result3.metadata.variation}</p>
            )}
            {result3?.metadata?.configuration && (
              <p className="config">
                Config: <code>{JSON.stringify(result3.metadata.configuration)}</code>
              </p>
            )}
          </div>

          {newFeatureEnabled && (
            <div className="alert alert-success">
              <strong>New Feature Enabled!</strong>
              <p>This feature is enabled for you based on your user attributes.</p>
              <button onClick={handleRiskyAction} className="btn">
                Test Error Tracking
              </button>
            </div>
          )}

          <div className="user-section">
            <h3>User Management</h3>
            <p>Current User ID: <code>{userId || 'Not set'}</code></p>
            <button onClick={() => setUserId('user-' + Date.now())} className="btn">
              Set Random User ID
            </button>
            <button onClick={() => setUserId(null)} className="btn btn-secondary">
              Clear User ID
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
