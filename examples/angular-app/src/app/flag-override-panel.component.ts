import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SavvagentService, FlagDefinition } from '@savvagent/angular';

const STORAGE_KEY = 'savvagent_local_overrides';

/**
 * Flag Override Panel Component
 * Developer tool for locally overriding feature flag values.
 * Per SDK Developer Guide: Client-side overrides for testing/debugging.
 *
 * This component uses the SavvagentService's built-in override methods,
 * which are applied at the evaluation level (before cache/API).
 */
@Component({
  selector: 'app-flag-override-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Trigger Button -->
    <button
      *ngIf="!isOpen"
      (click)="openPanel()"
      class="flag-panel-trigger"
      title="Open Flag Override Panel (Ctrl+Shift+F)"
    >
      <span class="flag-icon">&#9873;</span>
      <span *ngIf="activeOverrideCount > 0" class="override-badge">{{ activeOverrideCount }}</span>
    </button>

    <!-- Panel Overlay -->
    <div *ngIf="isOpen" class="flag-panel-overlay" (click)="closePanel()">
      <div class="flag-panel" (click)="$event.stopPropagation()">
        <div class="flag-panel-header">
          <h3>Feature Flag Overrides</h3>
          <div class="flag-panel-actions">
            <button
              (click)="fetchFlags()"
              class="flag-panel-btn flag-panel-btn-secondary"
              [disabled]="loading"
            >
              {{ loading ? 'Loading...' : 'Refresh' }}
            </button>
            <button
              (click)="clearAllOverrides()"
              class="flag-panel-btn flag-panel-btn-secondary"
              [disabled]="activeOverrideCount === 0"
            >
              Clear All
            </button>
            <button
              (click)="closePanel()"
              class="flag-panel-btn flag-panel-btn-close"
            >
              &times;
            </button>
          </div>
        </div>

        <p class="flag-panel-hint">
          Toggle flags locally for testing. Changes apply immediately.
          Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to toggle panel.
        </p>

        <div *ngIf="error" class="flag-panel-error">{{ error }}</div>

        <ng-container *ngIf="loading && flags.length === 0">
          <div class="flag-panel-loading">Loading flags...</div>
        </ng-container>

        <ng-container *ngIf="!loading && flags.length === 0">
          <div class="flag-panel-empty">No flags found</div>
        </ng-container>

        <div class="flag-list" *ngIf="flags.length > 0">
          <div
            *ngFor="let flag of flags"
            class="flag-item"
            [class.flag-item-overridden]="isOverridden(flag.key)"
          >
            <div class="flag-info">
              <div class="flag-key">
                {{ flag.key }}
                <span *ngIf="isOverridden(flag.key)" class="override-indicator">OVERRIDDEN</span>
              </div>
              <div class="flag-meta">
                <span class="flag-scope" [class.flag-scope-application]="flag.scope === 'application'" [class.flag-scope-enterprise]="flag.scope === 'enterprise'">
                  {{ flag.scope }}
                </span>
                <span class="flag-server-value">
                  Server: {{ flag.enabled ? 'ON' : 'OFF' }}
                </span>
              </div>
            </div>

            <div class="flag-controls">
              <button
                (click)="setOverride(flag.key, true)"
                class="flag-toggle-btn"
                [class.active]="getEffectiveValue(flag) && isOverridden(flag.key)"
                [class.server]="getEffectiveValue(flag) && !isOverridden(flag.key)"
              >
                ON
              </button>
              <button
                (click)="setOverride(flag.key, false)"
                class="flag-toggle-btn"
                [class.active]="!getEffectiveValue(flag) && isOverridden(flag.key)"
                [class.server]="!getEffectiveValue(flag) && !isOverridden(flag.key)"
              >
                OFF
              </button>
              <button
                *ngIf="isOverridden(flag.key)"
                (click)="clearOverride(flag.key)"
                class="flag-clear-btn"
                title="Use server value"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        <div class="flag-panel-footer">
          <span class="override-count">
            {{ activeOverrideCount }} override{{ activeOverrideCount !== 1 ? 's' : '' }} active
          </span>
          <span class="flag-panel-note">
            Overrides persist across page reloads.
          </span>
        </div>
      </div>
    </div>
  `,
})
export class FlagOverridePanelComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  isOpen = false;
  flags: FlagDefinition[] = [];
  overrides: Record<string, boolean> = {};
  loading = false;
  error: string | null = null;

  constructor(private savvagent: SavvagentService) {}

  ngOnInit(): void {
    // Load overrides from localStorage and apply to client on mount
    this.loadStoredOverrides();

    // Subscribe to override changes from the client
    const client = this.savvagent.flagClient;
    if (client) {
      client.onOverrideChange(() => {
        this.overrides = client.getOverrides();
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Keyboard shortcut: Ctrl+Shift+F to toggle panel
   */
  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.shiftKey && event.key === 'F') {
      event.preventDefault();
      this.isOpen = !this.isOpen;
      if (this.isOpen && this.savvagent.isReady) {
        this.fetchFlags();
      }
    }
  }

  /**
   * Get the count of active overrides
   */
  get activeOverrideCount(): number {
    return Object.keys(this.overrides).length;
  }

  /**
   * Load overrides from localStorage
   */
  private loadStoredOverrides(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsedOverrides = JSON.parse(stored) as Record<string, boolean>;
        this.savvagent.setOverrides(parsedOverrides);
        this.overrides = parsedOverrides;
      }
    } catch (e) {
      console.warn('[FlagOverridePanel] Failed to load overrides:', e);
    }
  }

  /**
   * Save overrides to localStorage
   */
  private saveOverrides(): void {
    try {
      if (Object.keys(this.overrides).length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (e) {
      console.warn('[FlagOverridePanel] Failed to save overrides:', e);
    }
  }

  /**
   * Open the panel
   */
  openPanel(): void {
    this.isOpen = true;
    if (this.savvagent.isReady) {
      this.fetchFlags();
    }
  }

  /**
   * Close the panel
   */
  closePanel(): void {
    this.isOpen = false;
  }

  /**
   * Fetch all flags
   */
  async fetchFlags(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      this.flags = await this.savvagent.getAllFlags('development');
    } catch (e) {
      this.error = 'Failed to fetch flags';
      console.error('[FlagOverridePanel] Error fetching flags:', e);
    } finally {
      this.loading = false;
    }
  }

  /**
   * Set an override for a flag
   */
  setOverride(flagKey: string, value: boolean): void {
    this.savvagent.setOverride(flagKey, value);
    this.overrides = this.savvagent.getOverrides();
    this.saveOverrides();
  }

  /**
   * Clear an override for a flag
   */
  clearOverride(flagKey: string): void {
    this.savvagent.clearOverride(flagKey);
    this.overrides = this.savvagent.getOverrides();
    this.saveOverrides();
  }

  /**
   * Clear all overrides
   */
  clearAllOverrides(): void {
    this.savvagent.clearAllOverrides();
    this.overrides = {};
    this.saveOverrides();
  }

  /**
   * Check if a flag is overridden
   */
  isOverridden(flagKey: string): boolean {
    return this.savvagent.hasOverride(flagKey);
  }

  /**
   * Get the effective value (override or server)
   */
  getEffectiveValue(flag: FlagDefinition): boolean {
    const override = this.overrides[flag.key];
    if (override !== undefined) {
      return override;
    }
    return flag.enabled;
  }
}
