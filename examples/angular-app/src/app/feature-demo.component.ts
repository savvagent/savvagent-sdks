import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SavvagentService, FlagObservableResult, FlagEvaluationResult } from '@savvagent/angular';

/**
 * Feature Demo Component
 * Demonstrates best practices for using Savvagent Angular SDK
 *
 * Uses the flag$ observable for reactive flag evaluation with automatic updates.
 */
@Component({
  selector: 'app-feature-demo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container">
      <h1>Savvagent Angular Example</h1>
      <p class="subtitle">SDK Developer Guide Best Practices Demo</p>

      <ng-container *ngIf="loading; else content">
        <p class="loading">Loading feature flags...</p>
      </ng-container>

      <ng-template #content>
        <!-- New Feature Card -->
        <div class="feature-card" [class.feature-card-overridden]="isNewFeatureOverridden">
          <h2>
            New Feature
            <span *ngIf="isNewFeatureOverridden" class="override-badge-inline">LOCAL OVERRIDE</span>
          </h2>
          <p>
            Status:
            <span class="status" [class.enabled]="newFeatureEnabled" [class.disabled]="!newFeatureEnabled">
              {{ newFeatureEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </p>
          <p *ngIf="isNewFeatureOverridden" class="server-value">
            Server value: {{ newFeatureEnabled ? 'Enabled' : 'Disabled' }}
          </p>
          <p *ngIf="newFeatureResult?.metadata?.variation" class="variation">
            Variation: {{ newFeatureResult?.metadata?.variation }}
          </p>
          <p *ngIf="newFeatureResult?.metadata?.configuration" class="config">
            Config: <code>{{ newFeatureResult?.metadata?.configuration | json }}</code>
          </p>
        </div>

        <!-- Beta Feature Card -->
        <div class="feature-card" [class.feature-card-overridden]="isBetaFeatureOverridden">
          <h2>
            Beta Feature
            <span *ngIf="isBetaFeatureOverridden" class="override-badge-inline">LOCAL OVERRIDE</span>
          </h2>
          <p>
            Status:
            <span class="status" [class.enabled]="betaFeatureEnabled" [class.disabled]="!betaFeatureEnabled">
              {{ betaFeatureEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </p>
          <p *ngIf="isBetaFeatureOverridden" class="server-value">
            Server value: {{ betaFeatureEnabled ? 'Enabled' : 'Disabled' }}
          </p>
          <p *ngIf="betaFeatureResult?.metadata?.variation" class="variation">
            Variation: {{ betaFeatureResult?.metadata?.variation }}
          </p>
        </div>

        <!-- Enterprise One Card -->
        <div class="feature-card" [class.feature-card-overridden]="isEnterpriseOneOverridden">
          <h2>
            Enterprise One
            <span *ngIf="isEnterpriseOneOverridden" class="override-badge-inline">LOCAL OVERRIDE</span>
          </h2>
          <p>
            Status:
            <span class="status" [class.enabled]="enterpriseOneEnabled" [class.disabled]="!enterpriseOneEnabled">
              {{ enterpriseOneEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </p>
          <p *ngIf="isEnterpriseOneOverridden" class="server-value">
            Server value: {{ enterpriseOneEnabled ? 'Enabled' : 'Disabled' }}
          </p>
          <p *ngIf="enterpriseOneResult?.metadata?.variation" class="variation">
            Variation: {{ enterpriseOneResult?.metadata?.variation }}
          </p>
          <p *ngIf="enterpriseOneResult?.metadata?.configuration" class="config">
            Config: <code>{{ enterpriseOneResult?.metadata?.configuration | json }}</code>
          </p>
        </div>

        <!-- New Feature Enabled Alert -->
        <div *ngIf="newFeatureEnabled" class="alert alert-success">
          <strong>New Feature Enabled!</strong>
          <p>This feature is enabled for you based on your user attributes.</p>
          <button (click)="handleRiskyAction()" class="btn">
            Test Error Tracking
          </button>
        </div>

        <!-- User Management Section -->
        <div class="user-section">
          <h3>User Management</h3>
          <p>Current User ID: <code>{{ currentUserId || 'Not set' }}</code></p>
          <button (click)="setRandomUserId()" class="btn">
            Set Random User ID
          </button>
          <button (click)="clearUserId()" class="btn btn-secondary">
            Clear User ID
          </button>
        </div>
      </ng-template>
    </div>
  `,
})
export class FeatureDemoComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Flag values
  newFeatureEnabled = false;
  betaFeatureEnabled = false;
  enterpriseOneEnabled = false;

  // Flag results for metadata
  newFeatureResult: FlagEvaluationResult | null = null;
  betaFeatureResult: FlagEvaluationResult | null = null;
  enterpriseOneResult: FlagEvaluationResult | null = null;

  // Override states
  isNewFeatureOverridden = false;
  isBetaFeatureOverridden = false;
  isEnterpriseOneOverridden = false;

  // Loading state
  loading = true;

  // User ID
  currentUserId: string | null = null;

  constructor(private savvagent: SavvagentService) {}

  ngOnInit(): void {
    // Subscribe to new-feature flag
    this.savvagent
      .flag$('new-feature', { defaultValue: false, realtime: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: FlagObservableResult) => {
        this.newFeatureEnabled = result.value;
        this.newFeatureResult = result.result;
        this.loading = result.loading;
        this.isNewFeatureOverridden = this.savvagent.hasOverride('new-feature');
      });

    // Subscribe to beta-feature flag
    this.savvagent
      .flag$('beta-feature', { defaultValue: false, realtime: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: FlagObservableResult) => {
        this.betaFeatureEnabled = result.value;
        this.betaFeatureResult = result.result;
        this.isBetaFeatureOverridden = this.savvagent.hasOverride('beta-feature');
      });

    // Subscribe to enterprise-one flag
    this.savvagent
      .flag$('enterprise-one', { defaultValue: false, realtime: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: FlagObservableResult) => {
        this.enterpriseOneEnabled = result.value;
        this.enterpriseOneResult = result.result;
        this.isEnterpriseOneOverridden = this.savvagent.hasOverride('enterprise-one');
      });

    // Get initial user ID
    this.currentUserId = this.savvagent.getUserId();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Example error handler demonstrating error tracking
   */
  handleRiskyAction(): void {
    try {
      // Simulated action that might fail
      throw new Error('Example error for demonstration');
    } catch (error) {
      // Track errors for AI-powered correlation
      this.savvagent.trackError('new-feature', error as Error);
      console.error('Action failed:', error);
    }
  }

  /**
   * Set a random user ID
   */
  setRandomUserId(): void {
    const userId = 'user-' + Date.now();
    this.savvagent.setUserId(userId);
    this.currentUserId = userId;
  }

  /**
   * Clear the user ID
   */
  clearUserId(): void {
    this.savvagent.setUserId(null);
    this.currentUserId = null;
  }
}
