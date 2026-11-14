import {
  useFlags,
  useHydratedFlags,
  useSavvagent,
  useTrackError,
  useUser,
} from '@savvagent/react-router';
import { FLAG_DEFAULTS, FLAG_KEYS } from '../savvagent';

/**
 * Feature Demo Component
 *
 * The root loader evaluates these flags on the server and passes them to
 * <SavvagentProvider flags>. useFlags starts from those values, so the server
 * HTML and the first client render already show the real flag states. Once
 * the browser SDK is ready it re-evaluates (applying local overrides and
 * realtime updates) and the hook switches to its own results.
 */
export function FeatureDemo() {
  const { client, isReady } = useSavvagent();
  const serverFlags = useHydratedFlags();

  const { values, loading, results } = useFlags(FLAG_KEYS, {
    defaultValues: FLAG_DEFAULTS,
    realtime: true,
  });

  const newFeatureEnabled = values['new-feature'];
  const betaFeatureEnabled = values['beta-feature'];
  const enterpriseOneEnabled = values['enterprise-one'];

  // Overrides live in the browser client, so they show once it is ready.
  const isNewFeatureOverridden = client?.hasOverride('new-feature') ?? false;
  const isBetaFeatureOverridden = client?.hasOverride('beta-feature') ?? false;
  const isEnterpriseOneOverridden = client?.hasOverride('enterprise-one') ?? false;

  const result1 = results['new-feature'];
  const result2 = results['beta-feature'];
  const result3 = results['enterprise-one'];

  const trackError = useTrackError('new-feature');
  const { userId, setUserId } = useUser();

  const handleRiskyAction = async () => {
    try {
      throw new Error('Example error for demonstration');
    } catch (error) {
      trackError(error as Error);
      console.error('Action failed:', error);
    }
  };

  // Ready once the browser client exists and this component reflects its state.
  const sdkReady = isReady && (client?.getUserId() ?? null) === (userId ?? null);

  const serverValue = (key: string) => (serverFlags[key]?.value ? 'Enabled' : 'Disabled');

  return (
    <div className="container">
      <h1>Savvagent React Router Example</h1>
      <p className="subtitle">Flags evaluated in a loader, hydrated without a flash of defaults</p>

      {/* The cards below are already server-rendered; this covers the moment
          before the browser SDK (overrides, user controls) is interactive. */}
      {!sdkReady && <p className="loading">Connecting the browser SDK...</p>}

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
            {isNewFeatureOverridden && <p className="server-value">Server value: {serverValue('new-feature')}</p>}
            {result1?.metadata?.variation && <p className="variation">Variation: {result1.metadata.variation}</p>}
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
            {isBetaFeatureOverridden && <p className="server-value">Server value: {serverValue('beta-feature')}</p>}
            {result2?.metadata?.variation && <p className="variation">Variation: {result2.metadata.variation}</p>}
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
              <p className="server-value">Server value: {serverValue('enterprise-one')}</p>
            )}
            {result3?.metadata?.variation && <p className="variation">Variation: {result3.metadata.variation}</p>}
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
              <button onClick={handleRiskyAction} className="btn" disabled={!sdkReady}>
                Test Error Tracking
              </button>
            </div>
          )}

          <div className="user-section">
            <h3>User Management</h3>
            <p>
              Current User ID: <code>{userId || 'Not set'}</code>
            </p>
            <button onClick={() => setUserId('user-' + Date.now())} className="btn" disabled={!sdkReady}>
              Set Random User ID
            </button>
            <button onClick={() => setUserId(null)} className="btn btn-secondary" disabled={!sdkReady}>
              Clear User ID
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
