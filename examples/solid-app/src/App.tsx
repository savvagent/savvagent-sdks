import { Show } from 'solid-js';
import { SavvagentProvider, createFeatureFlag } from '@savvagent/solid';

function FeatureDemo() {
  const [newFeatureEnabled, { loading: loading1 }] = createFeatureFlag(
    'new-feature',
    {
      userId: 'user-123',
      attributes: {
        email: 'user@example.com',
        plan: 'pro',
      },
    }
  );

  const [betaFeatureEnabled, { loading: loading2 }] = createFeatureFlag(
    'beta-feature',
    {
      userId: 'user-123',
    }
  );

  const loading = () => loading1() || loading2();

  return (
    <div class="container">
      <h1>Savvagent SolidJS Example</h1>

      <Show when={!loading()} fallback={<p class="loading">Loading feature flags...</p>}>
        <div>
          <div class="feature-card">
            <h2>New Feature</h2>
            <p>
              Status:
              <span class={`status ${newFeatureEnabled() ? 'enabled' : 'disabled'}`}>
                {newFeatureEnabled() ? 'Enabled' : 'Disabled'}
              </span>
            </p>
          </div>

          <div class="feature-card">
            <h2>Beta Feature</h2>
            <p>
              Status:
              <span class={`status ${betaFeatureEnabled() ? 'enabled' : 'disabled'}`}>
                {betaFeatureEnabled() ? 'Enabled' : 'Disabled'}
              </span>
            </p>
          </div>

          <Show when={newFeatureEnabled()}>
            <div class="alert alert-success">
              <strong>New Feature Enabled!</strong>
              <p>This feature is enabled for you based on your user attributes.</p>
            </div>
          </Show>
        </div>
      </Show>
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
