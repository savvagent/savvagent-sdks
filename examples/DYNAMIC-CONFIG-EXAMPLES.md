# Dynamic Configuration - Practical Examples

Real-world code examples for common scenarios.

---

## Example 1: E-Commerce Checkout Configuration

**Scenario:** Configure checkout experience dynamically.

**Flag Configuration:**
```json
{
  "production": {
    "enabled": true,
    "configuration": {
      "theme": {
        "primaryColor": "#007bff",
        "accentColor": "#28a745",
        "buttonRadius": "8px"
      },
      "features": {
        "expressCheckout": true,
        "guestCheckout": true,
        "savePaymentMethod": true
      },
      "limits": {
        "maxItems": 99,
        "minOrderValue": 10,
        "freeShippingThreshold": 50
      },
      "text": {
        "buttonText": "Complete Purchase",
        "loadingText": "Processing..."
      }
    }
  }
}
```

**TypeScript Implementation:**
```typescript
interface CheckoutConfig {
  theme: {
    primaryColor: string;
    accentColor: string;
    buttonRadius: string;
  };
  features: {
    expressCheckout: boolean;
    guestCheckout: boolean;
    savePaymentMethod: boolean;
  };
  limits: {
    maxItems: number;
    minOrderValue: number;
    freeShippingThreshold: number;
  };
  text: {
    buttonText: string;
    loadingText: string;
  };
}

async function initializeCheckout(userId: string, cart: ShoppingCart) {
  const config = await flagClient.getConfig<CheckoutConfig>(
    'checkout-experience',
    { userId },
    DEFAULT_CHECKOUT_CONFIG
  );

  // Validate cart
  if (cart.items.length > config.limits.maxItems) {
    throw new Error(`Maximum ${config.limits.maxItems} items allowed`);
  }

  if (cart.total < config.limits.minOrderValue) {
    throw new Error(`Minimum order value is $${config.limits.minOrderValue}`);
  }

  // Apply theme
  applyTheme({
    primary: config.theme.primaryColor,
    accent: config.theme.accentColor,
    buttonRadius: config.theme.buttonRadius
  });

  // Render checkout
  return renderCheckout({
    cart,
    config,
    showExpressCheckout: config.features.expressCheckout,
    allowGuestCheckout: config.features.guestCheckout,
    showSavePayment: config.features.savePaymentMethod,
    freeShippingAt: config.limits.freeShippingThreshold,
    buttonText: config.text.buttonText,
    loadingText: config.text.loadingText
  });
}
```

---

## Example 2: Search Algorithm A/B Test

**Scenario:** Compare 3 different search ranking algorithms.

**Flag Configuration:**
```json
{
  "variations": {
    "control": {
      "allocation": 50,
      "configuration": {
        "algorithm": "bm25",
        "params": {
          "k1": 1.2,
          "b": 0.75
        },
        "boosts": {
          "titleBoost": 2.0,
          "recencyBoost": 1.0,
          "popularityBoost": 1.0
        }
      }
    },
    "tuned_bm25": {
      "allocation": 25,
      "configuration": {
        "algorithm": "bm25",
        "params": {
          "k1": 1.5,
          "b": 0.6
        },
        "boosts": {
          "titleBoost": 3.0,
          "recencyBoost": 1.5,
          "popularityBoost": 1.2
        }
      }
    },
    "neural": {
      "allocation": 25,
      "configuration": {
        "algorithm": "neural",
        "params": {
          "model": "bert-base",
          "threshold": 0.7
        },
        "boosts": {
          "semanticBoost": 2.0,
          "contextBoost": 1.5
        }
      }
    }
  }
}
```

**Implementation:**
```typescript
interface SearchConfig {
  algorithm: string;
  params: Record<string, any>;
  boosts: Record<string, number>;
}

async function performSearch(query: string, userId: string) {
  const variation = await flagClient.getVariation('search-ranking', { userId });
  const config = variation.configuration as SearchConfig;

  const startTime = Date.now();
  let results: SearchResult[];

  switch (config.algorithm) {
    case 'bm25':
      results = await bm25Search(query, {
        k1: config.params.k1,
        b: config.params.b,
        titleBoost: config.boosts.titleBoost,
        recencyBoost: config.boosts.recencyBoost,
        popularityBoost: config.boosts.popularityBoost
      });
      break;

    case 'neural':
      results = await neuralSearch(query, {
        model: config.params.model,
        threshold: config.params.threshold,
        semanticBoost: config.boosts.semanticBoost,
        contextBoost: config.boosts.contextBoost
      });
      break;

    default:
      results = await bm25Search(query); // fallback
  }

  const duration = Date.now() - startTime;

  // Track metrics per variation
  analytics.track('search_completed', {
    query,
    variation: variation.variation,
    algorithm: config.algorithm,
    resultsCount: results.length,
    duration,
    userId
  });

  return results;
}

// Track user interactions with results
async function trackSearchClick(
  query: string,
  resultId: string,
  position: number,
  userId: string
) {
  const variation = await flagClient.getVariation('search-ranking', { userId });

  analytics.track('search_result_clicked', {
    query,
    resultId,
    position,
    variation: variation.variation,
    userId
  });
}
```

---

## Example 3: API Rate Limiting by User Plan

**Scenario:** Different rate limits for different subscription tiers.

**Flag Configurations:**

**Premium Users:**
```json
{
  "production": {
    "enabled": true,
    "targeting_rules": {
      "attributes": [
        { "key": "plan", "operator": "in", "values": ["premium", "enterprise"] }
      ]
    },
    "configuration": {
      "rateLimit": {
        "requestsPerMinute": 1000,
        "requestsPerHour": 50000,
        "burstAllowance": 200
      },
      "features": {
        "priorityQueue": true,
        "advancedEndpoints": true,
        "webhooks": true
      },
      "quotas": {
        "maxProjects": 100,
        "maxStorage": "100GB",
        "maxTeamMembers": 50
      }
    }
  }
}
```

**Free Users:**
```json
{
  "production": {
    "enabled": true,
    "configuration": {
      "rateLimit": {
        "requestsPerMinute": 60,
        "requestsPerHour": 1000,
        "burstAllowance": 10
      },
      "features": {
        "priorityQueue": false,
        "advancedEndpoints": false,
        "webhooks": false
      },
      "quotas": {
        "maxProjects": 3,
        "maxStorage": "1GB",
        "maxTeamMembers": 5
      }
    }
  }
}
```

**Implementation:**
```typescript
import rateLimit from 'express-rate-limit';

interface UserLimits {
  rateLimit: {
    requestsPerMinute: number;
    requestsPerHour: number;
    burstAllowance: number;
  };
  features: {
    priorityQueue: boolean;
    advancedEndpoints: boolean;
    webhooks: boolean;
  };
  quotas: {
    maxProjects: number;
    maxStorage: string;
    maxTeamMembers: number;
  };
}

// Middleware to enforce rate limits
const rateLimitMiddleware = async (req, res, next) => {
  const userId = req.user.id;
  const userPlan = req.user.subscriptionPlan;

  const limits = await flagClient.getConfig<UserLimits>(
    'user-limits',
    { userId, attributes: { plan: userPlan } },
    DEFAULT_FREE_LIMITS
  );

  // Apply rate limit
  const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: limits.rateLimit.requestsPerMinute,
    message: {
      error: 'Too many requests',
      limit: limits.rateLimit.requestsPerMinute,
      upgrade: userPlan === 'free' ? 'Upgrade to Premium for higher limits' : null
    }
  });

  // Store limits in request for later use
  req.userLimits = limits;

  limiter(req, res, next);
};

// Enforce feature access
const requireFeature = (featureName: string) => {
  return async (req, res, next) => {
    const limits = req.userLimits as UserLimits;

    if (!limits.features[featureName]) {
      return res.status(403).json({
        error: 'Feature not available',
        feature: featureName,
        plan: req.user.subscriptionPlan,
        message: 'Upgrade your plan to access this feature'
      });
    }

    next();
  };
};

// Usage in routes
app.post('/api/projects',
  rateLimitMiddleware,
  async (req, res) => {
    const user = req.user;
    const limits = req.userLimits;

    // Check project quota
    const projectCount = await getProjectCount(user.id);
    if (projectCount >= limits.quotas.maxProjects) {
      return res.status(403).json({
        error: 'Project limit reached',
        current: projectCount,
        max: limits.quotas.maxProjects,
        message: `You have reached your limit of ${limits.quotas.maxProjects} projects`
      });
    }

    // Create project...
  }
);

app.post('/api/advanced/analyze',
  rateLimitMiddleware,
  requireFeature('advancedEndpoints'),
  async (req, res) => {
    // This endpoint only accessible to premium users
  }
);
```

---

## Example 4: Progressive Rollout with Fallback

**Scenario:** Roll out new payment processor with automatic fallback.

**Flag Configuration:**
```json
{
  "production": {
    "enabled": true,
    "rollout_percentage": 10,
    "configuration": {
      "primary": {
        "provider": "stripe_v2",
        "endpoint": "https://api.stripe.com/v2",
        "timeout": 5000,
        "maxRetries": 2
      },
      "fallback": {
        "provider": "stripe_v1",
        "endpoint": "https://api.stripe.com/v1",
        "timeout": 10000,
        "maxRetries": 3
      },
      "circuitBreaker": {
        "failureThreshold": 5,
        "resetTimeout": 30000,
        "monitorWindow": 60000
      }
    }
  }
}
```

**Implementation:**
```typescript
interface PaymentConfig {
  primary: {
    provider: string;
    endpoint: string;
    timeout: number;
    maxRetries: number;
  };
  fallback: {
    provider: string;
    endpoint: string;
    timeout: number;
    maxRetries: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeout: number;
    monitorWindow: number;
  };
}

class PaymentProcessor {
  private circuitBreaker: Map<string, {
    failures: number;
    lastFailure: number;
    isOpen: boolean;
  }> = new Map();

  async processPayment(
    orderId: string,
    amount: number,
    userId: string
  ): Promise<PaymentResult> {
    const config = await flagClient.getConfig<PaymentConfig>(
      'payment-processor',
      { userId },
      DEFAULT_PAYMENT_CONFIG
    );

    const startTime = Date.now();
    let result: PaymentResult;
    let usedFallback = false;

    try {
      // Check circuit breaker
      if (this.isCircuitOpen(config.primary.provider, config)) {
        console.log('Circuit breaker open, using fallback immediately');
        result = await this.processWithProvider(
          config.fallback,
          orderId,
          amount
        );
        usedFallback = true;
      } else {
        // Try primary
        try {
          result = await this.processWithProvider(
            config.primary,
            orderId,
            amount
          );
          this.recordSuccess(config.primary.provider);
        } catch (primaryError) {
          console.error('Primary payment failed:', primaryError);
          this.recordFailure(config.primary.provider, config);

          // Fall back to secondary
          console.log('Falling back to secondary processor');
          result = await this.processWithProvider(
            config.fallback,
            orderId,
            amount
          );
          usedFallback = true;
        }
      }

      const duration = Date.now() - startTime;

      // Track metrics
      analytics.track('payment_processed', {
        orderId,
        amount,
        provider: usedFallback ? config.fallback.provider : config.primary.provider,
        usedFallback,
        duration,
        success: true
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;

      // Both failed
      analytics.track('payment_failed', {
        orderId,
        amount,
        error: error.message,
        duration,
        triedFallback: usedFallback
      });

      throw error;
    }
  }

  private async processWithProvider(
    provider: PaymentConfig['primary'],
    orderId: string,
    amount: number
  ): Promise<PaymentResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.timeout);

    try {
      for (let attempt = 0; attempt < provider.maxRetries; attempt++) {
        try {
          const response = await fetch(`${provider.endpoint}/charge`, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, amount })
          });

          if (response.ok) {
            return await response.json();
          }

          if (attempt < provider.maxRetries - 1) {
            await this.sleep(1000 * Math.pow(2, attempt)); // Exponential backoff
          }
        } catch (err) {
          if (attempt === provider.maxRetries - 1) throw err;
        }
      }

      throw new Error('Max retries exceeded');
    } finally {
      clearTimeout(timeout);
    }
  }

  private isCircuitOpen(provider: string, config: PaymentConfig): boolean {
    const breaker = this.circuitBreaker.get(provider);
    if (!breaker || !breaker.isOpen) return false;

    // Check if reset timeout has passed
    const now = Date.now();
    if (now - breaker.lastFailure > config.circuitBreaker.resetTimeout) {
      breaker.isOpen = false;
      breaker.failures = 0;
      return false;
    }

    return true;
  }

  private recordFailure(provider: string, config: PaymentConfig): void {
    const breaker = this.circuitBreaker.get(provider) || {
      failures: 0,
      lastFailure: 0,
      isOpen: false
    };

    breaker.failures++;
    breaker.lastFailure = Date.now();

    if (breaker.failures >= config.circuitBreaker.failureThreshold) {
      breaker.isOpen = true;
      console.error(`Circuit breaker opened for ${provider}`);

      // Alert operations team
      alertOps({
        severity: 'high',
        message: `Payment processor ${provider} circuit breaker opened`,
        failures: breaker.failures
      });
    }

    this.circuitBreaker.set(provider, breaker);
  }

  private recordSuccess(provider: string): void {
    const breaker = this.circuitBreaker.get(provider);
    if (breaker) {
      breaker.failures = 0;
      breaker.isOpen = false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

---

## Example 5: Mobile App Feature Configuration

**Scenario:** Configure mobile app features dynamically.

**Flag Configuration:**
```json
{
  "production": {
    "enabled": true,
    "configuration": {
      "ui": {
        "theme": "dark",
        "accentColor": "#007AFF",
        "fontSize": 16,
        "animations": true
      },
      "features": {
        "offlineMode": true,
        "pushNotifications": true,
        "biometricAuth": true,
        "autoSync": true
      },
      "sync": {
        "intervalMinutes": 15,
        "wifiOnly": false,
        "maxRetries": 3
      },
      "cache": {
        "maxSizeMB": 100,
        "ttlHours": 24,
        "preloadImages": true
      }
    }
  }
}
```

**Android Implementation:**
```kotlin
data class AppConfig(
    val ui: UiConfig,
    val features: FeatureConfig,
    val sync: SyncConfig,
    val cache: CacheConfig
)

data class UiConfig(
    val theme: String,
    val accentColor: String,
    val fontSize: Int,
    val animations: Boolean
)

data class FeatureConfig(
    val offlineMode: Boolean,
    val pushNotifications: Boolean,
    val biometricAuth: Boolean,
    val autoSync: Boolean
)

data class SyncConfig(
    val intervalMinutes: Int,
    val wifiOnly: Boolean,
    val maxRetries: Int
)

data class CacheConfig(
    val maxSizeMB: Int,
    val ttlHours: Int,
    val preloadImages: Boolean
)

class App : Application() {
    lateinit var config: AppConfig
        private set

    override fun onCreate() {
        super.onCreate()

        lifecycleScope.launch {
            loadConfiguration()
        }
    }

    private suspend fun loadConfiguration() {
        val userContext = UserContext(
            userId = getUserId(),
            attributes = mapOf(
                "appVersion" to BuildConfig.VERSION_NAME,
                "platform" to "android"
            )
        )

        val configMap = savvagentClient
            .getConfig("app-config", userContext)
            .getOrNull()

        config = if (configMap != null) {
            parseConfig(configMap)
        } else {
            getDefaultConfig()
        }

        applyConfiguration()
    }

    private fun applyConfiguration() {
        // Apply UI theme
        if (config.ui.theme == "dark") {
            AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
        }

        // Configure sync
        if (config.features.autoSync) {
            WorkManager.getInstance(this).enqueuePeriodicWork(
                PeriodicWorkRequestBuilder<SyncWorker>(
                    config.sync.intervalMinutes.toLong(),
                    TimeUnit.MINUTES
                ).setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(
                            if (config.sync.wifiOnly) NetworkType.UNMETERED
                            else NetworkType.CONNECTED
                        )
                        .build()
                ).build()
            )
        }

        // Configure cache
        setupImageCache(config.cache)

        // Enable features
        if (config.features.pushNotifications) {
            FirebaseMessaging.getInstance().subscribeToTopic("updates")
        }
    }
}
```

---

## Summary

These examples demonstrate:
- ✅ Type-safe configuration handling
- ✅ Fallback strategies
- ✅ A/B testing with metrics
- ✅ Progressive rollouts
- ✅ Circuit breaker patterns
- ✅ Multi-tier user management
- ✅ Mobile app configuration

For more examples, see:
- [Dynamic Configuration Guide](../docs/DYNAMIC-CONFIGURATION-GUIDE.md)
- [Migration Guide](../docs/MIGRATION-GUIDE.md)
