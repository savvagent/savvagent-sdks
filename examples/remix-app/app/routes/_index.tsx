import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { createSavvagentLoader } from '@savvagent/remix';

const savvagent = createSavvagentLoader({
  apiUrl: process.env.SAVVAGENT_API_URL || 'http://localhost:8080',
  sdkKey: process.env.SAVVAGENT_SDK_KEY || 'your-sdk-key',
  environment: 'development',
});

export async function loader({ request }: LoaderFunctionArgs) {
  const [newFeatureEnabled, betaFeatureEnabled] = await Promise.all([
    savvagent.isEnabled('new-feature', {
      userId: 'user-123',
      attributes: {
        email: 'user@example.com',
        plan: 'pro',
      },
    }),
    savvagent.isEnabled('beta-feature', {
      userId: 'user-123',
    }),
  ]);

  return json({
    newFeatureEnabled,
    betaFeatureEnabled,
  });
}

export default function Index() {
  const { newFeatureEnabled, betaFeatureEnabled } = useLoaderData<typeof loader>();

  return (
    <div className="container">
      <h1>Savvagent Remix Example</h1>

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
    </div>
  );
}
