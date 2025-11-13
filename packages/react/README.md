# @savvagent/react

React SDK for Savvagent - AI-powered feature flags that prevent production incidents.

## Installation

```bash
npm install @savvagent/react
# or
pnpm add @savvagent/react
# or
yarn add @savvagent/react
```

## Quick Start

### 1. Wrap your app with SavvagentProvider

```tsx
import { SavvagentProvider } from '@savvagent/react';

function App() {
  return (
    <SavvagentProvider
      config={{
        apiKey: 'sdk_your_api_key_here',
        applicationId: 'your-app-id', // Optional: for application-scoped flags
        enableRealtime: true, // Enable real-time flag updates
      }}
    >
      <YourApp />
    </SavvagentProvider>
  );
}
```

### 2. Use the useFlag hook

```tsx
import { useFlag } from '@savvagent/react';

function MyFeature() {
  const { value: isEnabled, loading } = useFlag('new-checkout-flow', {
    defaultValue: false,
    realtime: true,
  });

  if (loading) {
    return <div>Loading...</div>;
  }

  return isEnabled ? <NewCheckout /> : <OldCheckout />;
}
```

## API Reference

### `<SavvagentProvider>`

Provider component that initializes the Savvagent client and makes it available to all child components.

#### Props

```tsx
interface SavvagentProviderProps {
  config: FlagClientConfig;
  children: React.ReactNode;
}

interface FlagClientConfig {
  /** SDK API key (starts with sdk_) */
  apiKey: string;
  /** Application ID for application-scoped flags */
  applicationId?: string;
  /** Base URL for the Savvagent API */
  baseUrl?: string;
  /** Enable real-time flag updates via SSE (default: true) */
  enableRealtime?: boolean;
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTtl?: number;
  /** Enable telemetry tracking (default: true) */
  enableTelemetry?: boolean;
  /** Default flag values when evaluation fails */
  defaults?: Record<string, boolean>;
  /** Custom error handler */
  onError?: (error: Error) => void;
  /** Default language for targeting */
  defaultLanguage?: string;
  /** Disable automatic browser language detection */
  disableLanguageDetection?: boolean;
}
```

### `useFlag(flagKey, options)`

Hook to evaluate a feature flag with automatic updates.

#### Parameters

- `flagKey: string` - The feature flag key to evaluate
- `options?: UseFlagOptions` - Configuration options

```tsx
interface UseFlagOptions {
  /** Context for flag evaluation (user_id, attributes, etc.) */
  context?: FlagContext;
  /** Default value to use while loading or on error */
  defaultValue?: boolean;
  /** Enable real-time updates for this flag (default: true) */
  realtime?: boolean;
  /** Custom error handler */
  onError?: (error: Error) => void;
}
```

#### Returns

```tsx
interface UseFlagResult {
  /** Current flag value */
  value: boolean;
  /** Whether the flag is currently being evaluated */
  loading: boolean;
  /** Error if evaluation failed */
  error: Error | null;
  /** Detailed evaluation result */
  result: FlagEvaluationResult | null;
  /** Force re-evaluation of the flag */
  refetch: () => Promise<void>;
}
```

#### Example

```tsx
function MyComponent() {
  const { value, loading, error, refetch } = useFlag('beta-feature', {
    context: {
      user_id: user?.id,
      attributes: {
        plan: user?.plan,
        country: user?.country,
      },
    },
    defaultValue: false,
    realtime: true,
    onError: (err) => console.error('Flag evaluation failed:', err),
  });

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <div>
      {value ? <BetaFeature /> : <StandardFeature />}
      <button onClick={() => refetch()}>Refresh Flag</button>
    </div>
  );
}
```

### `useSavvagent()`

Hook to access the underlying Savvagent client instance for advanced use cases.

#### Returns

```tsx
interface SavvagentContextValue {
  /** The FlagClient instance */
  client: FlagClient | null;
  /** Whether the client is ready */
  isReady: boolean;
}
```

#### Example

```tsx
function AdvancedComponent() {
  const { client, isReady } = useSavvagent();

  useEffect(() => {
    if (!isReady || !client) return;

    // Use client directly
    const checkMultipleFlags = async () => {
      const flag1 = await client.isEnabled('feature-1');
      const flag2 = await client.isEnabled('feature-2');
      console.log({ flag1, flag2 });
    };

    checkMultipleFlags();
  }, [client, isReady]);

  return <div>Content</div>;
}
```

### `useWithFlag(flagKey, callback, options)`

Hook to execute a callback conditionally based on a flag value.

#### Example

```tsx
function AnalyticsComponent() {
  useWithFlag('analytics-enabled', async () => {
    await trackEvent('page_view', {
      page: window.location.pathname,
    });
  });

  return <PageContent />;
}
```

### `useUser()`

Hook to manage user identification for targeted flag evaluation.

#### Returns

```tsx
{
  setUserId: (userId: string | null) => void;
  getUserId: () => string | null;
  getAnonymousId: () => string | null;
  setAnonymousId: (id: string) => void;
}
```

#### Example

```tsx
function AuthHandler() {
  const { setUserId } = useUser();

  useEffect(() => {
    if (user) {
      setUserId(user.id);
    } else {
      setUserId(null); // Clear on logout
    }
  }, [user, setUserId]);

  return null;
}
```

### `useTrackError(flagKey, context)`

Hook to track errors with flag context for AI-powered error analysis.

#### Example

```tsx
function FeatureComponent() {
  const trackError = useTrackError('new-payment-flow');
  const [result, setResult] = useState(null);

  const handlePayment = async () => {
    try {
      const result = await processPayment();
      setResult(result);
    } catch (error) {
      trackError(error as Error);
      toast.error('Payment failed');
    }
  };

  return <button onClick={handlePayment}>Pay Now</button>;
}
```

## Advanced Examples

### User Targeting

```tsx
function UserSpecificFeature() {
  const user = useCurrentUser();
  const { value: showPremium } = useFlag('premium-features', {
    context: {
      user_id: user.id,
      attributes: {
        plan: user.subscription.plan,
        signupDate: user.createdAt,
      },
    },
  });

  return showPremium ? <PremiumDashboard /> : <StandardDashboard />;
}
```

### Language Targeting

```tsx
function LocalizedFeature() {
  const { i18n } = useTranslation();
  const { value: showLocalFeature } = useFlag('regional-promotion', {
    context: {
      language: i18n.language, // e.g., 'en-US', 'fr-FR'
    },
  });

  return showLocalFeature ? <RegionalPromo /> : null;
}
```

### A/B Testing

```tsx
function ABTest() {
  const user = useCurrentUser();
  const { value: variantB } = useFlag('checkout-variant-b', {
    context: {
      user_id: user.id, // Consistent assignment per user
    },
  });

  return variantB ? <CheckoutVariantB /> : <CheckoutVariantA />;
}
```

### Error Tracking

```tsx
function ExperimentalFeature() {
  const trackError = useTrackError('experimental-algorithm');

  const handleComputation = async () => {
    try {
      const result = await experimentalComputation();
      return result;
    } catch (error) {
      // Error is automatically correlated with flag changes
      trackError(error as Error);
      throw error;
    }
  };

  return <ComputationUI onCompute={handleComputation} />;
}
```

## TypeScript Support

This package is written in TypeScript and provides full type definitions.

```tsx
import type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  UseFlagOptions,
  UseFlagResult,
} from '@savvagent/react';
```

## Best Practices

1. **Place SavvagentProvider high in your component tree** to ensure all components have access to the client.

2. **Use the `defaultValue` option** to provide a safe fallback while flags are loading.

3. **Enable real-time updates** for flags that change frequently or require immediate propagation.

4. **Track errors** in new features to leverage Savvagent's AI-powered error correlation.

5. **Use user context** for targeted rollouts based on user attributes, location, or behavior.

6. **Handle loading states** gracefully to provide a smooth user experience.

## License

MIT
