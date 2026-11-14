import { Component, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
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
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div class="container">
      <h1>Savvagent Angular Example</h1>
      <p class="subtitle">SDK Developer Guide Best Practices Demo</p>

      @if (loading) {
        <p class="loading">Loading feature flags...</p>
      } @else {
        <!-- New Feature Card -->
        <div class="feature-card" [class.feature-card-overridden]="isOverridden('new-feature')">
          <h2>
            New Feature
            @if (isOverridden('new-feature')) {
              <span class="override-badge-inline">LOCAL OVERRIDE</span>
            }
          </h2>
          <p>
            Status:
            <span class="status" [class.enabled]="newFeatureEnabled" [class.disabled]="!newFeatureEnabled">
              {{ newFeatureEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </p>
          @if (isOverridden('new-feature')) {
            <p class="server-value">Server value: {{ newFeatureEnabled ? 'Enabled' : 'Disabled' }}</p>
          }
          @if (newFeatureResult?.metadata?.variation) {
            <p class="variation">Variation: {{ newFeatureResult?.metadata?.variation }}</p>
          }
          @if (newFeatureResult?.metadata?.configuration) {
            <p class="config">
              Config:
              <code>{{ newFeatureResult?.metadata?.configuration | json }}</code>
            </p>
          }
        </div>
        <!-- Beta Feature Card -->
        <div class="feature-card" [class.feature-card-overridden]="isOverridden('beta-feature')">
          <h2>
            Beta Feature
            @if (isOverridden('beta-feature')) {
              <span class="override-badge-inline">LOCAL OVERRIDE</span>
            }
          </h2>
          <p>
            Status:
            <span class="status" [class.enabled]="betaFeatureEnabled" [class.disabled]="!betaFeatureEnabled">
              {{ betaFeatureEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </p>
          @if (isOverridden('beta-feature')) {
            <p class="server-value">Server value: {{ betaFeatureEnabled ? 'Enabled' : 'Disabled' }}</p>
          }
          @if (betaFeatureResult?.metadata?.variation) {
            <p class="variation">Variation: {{ betaFeatureResult?.metadata?.variation }}</p>
          }
        </div>
        <!-- Enterprise One Card -->
        <div class="feature-card" [class.feature-card-overridden]="isOverridden('enterprise-one')">
          <h2>
            Enterprise One
            @if (isOverridden('enterprise-one')) {
              <span class="override-badge-inline">LOCAL OVERRIDE</span>
            }
          </h2>
          <p>
            Status:
            <span class="status" [class.enabled]="enterpriseOneEnabled" [class.disabled]="!enterpriseOneEnabled">
              {{ enterpriseOneEnabled ? 'Enabled' : 'Disabled' }}
            </span>
          </p>
          @if (isOverridden('enterprise-one')) {
            <p class="server-value">Server value: {{ enterpriseOneEnabled ? 'Enabled' : 'Disabled' }}</p>
          }
          @if (enterpriseOneResult?.metadata?.variation) {
            <p class="variation">Variation: {{ enterpriseOneResult?.metadata?.variation }}</p>
          }
          @if (enterpriseOneResult?.metadata?.configuration) {
            <p class="config">
              Config:
              <code>{{ enterpriseOneResult?.metadata?.configuration | json }}</code>
            </p>
          }
        </div>
        <!-- New Feature Enabled Alert -->
        @if (newFeatureEnabled) {
          <div class="alert alert-success">
            <strong>New Feature Enabled!</strong>
            <p>This feature is enabled for you based on your user attributes.</p>
            <button (click)="handleRiskyAction()" class="btn">Test Error Tracking</button>
          </div>
        }
        <!-- User Management Section -->
        <div class="user-section">
          <h3>User Management</h3>
          <p>
            Current User ID: <code>{{ currentUserId || 'Not set' }}</code>
          </p>
          <button (click)="setRandomUserId()" class="btn">Set Random User ID</button>
          <button (click)="clearUserId()" class="btn btn-secondary">Clear User ID</button>
        </div>
      }
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
      });

    // Subscribe to beta-feature flag
    this.savvagent
      .flag$('beta-feature', { defaultValue: false, realtime: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: FlagObservableResult) => {
        this.betaFeatureEnabled = result.value;
        this.betaFeatureResult = result.result;
      });

    // Subscribe to enterprise-one flag
    this.savvagent
      .flag$('enterprise-one', { defaultValue: false, realtime: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: FlagObservableResult) => {
        this.enterpriseOneEnabled = result.value;
        this.enterpriseOneResult = result.result;
      });

    // Get initial user ID
    this.currentUserId = this.savvagent.getUserId();
  }

  /**
   * Whether a flag has a local override. Read on every change detection pass, so the
   * badge follows override changes even when the evaluated value does not change.
   */
  isOverridden(flagKey: string): boolean {
    return this.savvagent.hasOverride(flagKey);
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
