'use client';

import { SavvagentProvider } from '@savvagent/nextjs/client';
import type { FlagClientConfig, DefaultFlagContext } from '@savvagent/nextjs/client';
import './globals.css';

/**
 * Root Layout with SavvagentProvider
 * Per SDK Developer Guide: Initialize once, create a single SDK instance at application startup
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per SDK Developer Guide: FlagClientConfig with proper authentication
  const config: FlagClientConfig = {
    // SDK API key (starts with sdk_) - safe to embed in client-side code
    apiKey: process.env.NEXT_PUBLIC_SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
    // Base URL for the Savvagent API
    baseUrl: process.env.NEXT_PUBLIC_SAVVAGENT_API_URL || 'http://localhost:8080',
    // Application ID for application-scoped flags
    applicationId: 'f8209ef5-a661-4f46-8b84-4c855a97d5ef',
    // Enable real-time updates via SSE (default: true)
    enableRealtime: true,
    // Enable telemetry tracking (default: true)
    enableTelemetry: true,
    // Cache TTL in milliseconds (default: 60000 = 1 minute)
    cacheTtl: 60000,
    // Default flag values when evaluation fails
    defaults: {
      'new-feature': false,
      'beta-feature': false,
      'enterprise-one': false,
    },
    // Custom error handler
    onError: (error) => {
      console.error('[App] Savvagent error:', error);
    },
  };

  // Per SDK Developer Guide: Default context values applied to all flag evaluations
  // Always provide user context for consistent rollout behavior
  const defaultContext: DefaultFlagContext = {
    // Environment (development, staging, production)
    environment: 'development',
    // Default user ID (required for percentage rollouts)
    userId: 'user-123',
    // Organization ID for multi-tenant apps
    organizationId: 'org-456',
    // Session ID as fallback identifier (per SDK Developer Guide)
    sessionId: `session_${Date.now()}`,
    // User's language code (e.g., "en", "es")
    language: 'en',
    // Custom attributes for targeting rules
    attributes: {
      plan: 'premium',
      country: 'US',
    },
  };

  return (
    <html lang="en">
      <body>
        <SavvagentProvider config={config} defaultContext={defaultContext}>
          {children}
        </SavvagentProvider>
      </body>
    </html>
  );
}
