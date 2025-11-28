import { bootstrapApplication } from '@angular/platform-browser';
import { importProvidersFrom } from '@angular/core';
import { SavvagentModule } from '@savvagent/angular';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(
      SavvagentModule.forRoot({
        config: {
          // SDK API key (starts with sdk_) - safe to embed in client-side code
          apiKey: environment.savvagentSdkKey,
          // Base URL for the Savvagent API
          baseUrl: environment.savvagentApiUrl,
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
        },
        // Per SDK Developer Guide: Default context values applied to all flag evaluations
        defaultContext: {
          environment: 'development',
          userId: 'user-123',
          organizationId: 'org-456',
          sessionId: `session_${Date.now()}`,
          language: 'en',
          attributes: {
            plan: 'premium',
            country: 'US',
          },
        },
      })
    ),
  ],
}).catch((err) => console.error(err));
