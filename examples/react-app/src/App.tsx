import { SavvagentProvider, useFeatureFlag } from '@savvagent/react';

function FeatureDemo() {
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

  const loading = loading1 || loading2;

  return (
    <div className="container">
      <h1>Savvagent React Example</h1>

      {loading ? (
        <p className="loading">Loading feature flags...</p>
      ) : (
        <div>
          <div className="feature-card">
            <h2>New Feature</h2>
            <p>
              Status:
              <span className={`status ${newFeatureEnabled ? 'enabled' : 'disabled'}`}>
                {newFeatureEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
          </div>

          <div className="feature-card">
            <h2>Beta Feature</h2>
            <p>
              Status:
              <span className={`status ${betaFeatureEnabled ? 'enabled' : 'disabled'}`}>
                {betaFeatureEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
          </div>

          {newFeatureEnabled && (
            <div className="alert alert-success">
              <strong>New Feature Enabled!</strong>
              <p>This feature is enabled for you based on your user attributes.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <SavvagentProvider
      apiUrl={import.meta.env.VITE_SAVVAGENT_API_URL || 'http://localhost:8080'}
      sdkKey={import.meta.env.VITE_SAVVAGENT_SDK_KEY || 'your-sdk-key'}
      environment="development"
    >
      <FeatureDemo />
    </SavvagentProvider>
  );
}

export default App;
