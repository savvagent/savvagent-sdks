import { NgModule, ModuleWithProviders } from '@angular/core';
import { SavvagentService, SavvagentConfig, SAVVAGENT_CONFIG } from './service';

/**
 * Angular module for Savvagent feature flags.
 *
 * @example
 * ```typescript
 * // app.module.ts
 * import { SavvagentModule } from '@savvagent/angular';
 *
 * @NgModule({
 *   imports: [
 *     SavvagentModule.forRoot({
 *       config: {
 *         apiKey: 'sdk_your_api_key',
 *         baseUrl: 'https://api.savvagent.com'
 *       },
 *       defaultContext: {
 *         applicationId: 'my-app',
 *         environment: 'production',
 *         userId: 'user-123'
 *       }
 *     })
 *   ]
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * ```typescript
 * // For standalone components (Angular 14+)
 * import { SavvagentModule } from '@savvagent/angular';
 *
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     importProvidersFrom(
 *       SavvagentModule.forRoot({
 *         config: { apiKey: 'sdk_...' }
 *       })
 *     )
 *   ]
 * });
 * ```
 */
@NgModule({
  providers: [SavvagentService]
})
export class SavvagentModule {
  /**
   * Configure the Savvagent module with API key and default context.
   *
   * @param savvagentConfig - Configuration including API key and optional default context
   * @returns Module with providers
   */
  static forRoot(savvagentConfig: SavvagentConfig): ModuleWithProviders<SavvagentModule> {
    return {
      ngModule: SavvagentModule,
      providers: [
        {
          provide: SAVVAGENT_CONFIG,
          useValue: savvagentConfig
        },
        SavvagentService
      ]
    };
  }
}
