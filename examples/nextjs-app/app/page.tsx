'use client';

import { SavvagentClient } from '@savvagent/sdk';
import { useEffect, useState } from 'react';

export default function Home() {
  const [newFeatureEnabled, setNewFeatureEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new SavvagentClient({
      apiUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL || 'http://localhost:8080',
      sdkKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY || 'your-sdk-key',
      environment: 'development',
    });

    async function checkFlag() {
      try {
        const isEnabled = await client.isEnabled('new-feature', {
          userId: 'user-123',
          attributes: {
            email: 'user@example.com',
            plan: 'pro',
          },
        });
        setNewFeatureEnabled(isEnabled);
      } catch (error) {
        console.error('Error checking flag:', error);
      } finally {
        setLoading(false);
      }
    }

    checkFlag();
  }, []);

  return (
    <main className="min-h-screen p-24">
      <h1 className="text-4xl font-bold mb-8">Savvagent Next.js Example</h1>

      {loading ? (
        <p>Loading feature flags...</p>
      ) : (
        <div className="space-y-4">
          <div className="border p-4 rounded">
            <h2 className="text-2xl font-semibold mb-2">New Feature</h2>
            <p>
              Status:{' '}
              <span className={newFeatureEnabled ? 'text-green-600' : 'text-red-600'}>
                {newFeatureEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </p>
          </div>

          {newFeatureEnabled && (
            <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded">
              <strong className="font-bold">New Feature!</strong>
              <span className="block sm:inline"> This feature is enabled for you.</span>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
