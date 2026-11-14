import { Component } from '@angular/core';
import { FeatureDemoComponent } from './feature-demo.component';
import { FlagOverridePanelComponent } from './flag-override-panel.component';

/**
 * Main App Component
 * Per SDK Developer Guide: Initialize once, create a single SDK instance at application startup
 * The SavvagentModule is configured in main.ts with forRoot()
 */
@Component({
  selector: 'app-root',
  imports: [FeatureDemoComponent, FlagOverridePanelComponent],
  template: `
    <app-feature-demo></app-feature-demo>
    <app-flag-override-panel></app-flag-override-panel>
  `,
})
export class AppComponent {}
