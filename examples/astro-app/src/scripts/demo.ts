/**
 * Browser side of the Astro demo.
 *
 * The page arrives fully rendered by the server (via `Astro.locals.savvagent`).
 * This plain client script, with no UI framework, takes over from there:
 * it applies local overrides from the flag override panel, switches users
 * and re-evaluates flags, and updates the server-rendered DOM in place.
 */

import { FlagClient } from '@savvagent/sdk';
import type { FlagClientConfig, FlagContext, FlagDefinition } from '@savvagent/sdk';

const OVERRIDE_STORAGE_KEY = 'savvagent_local_overrides';
const USER_COOKIE = 'user_id';

interface InitialState {
  config: FlagClientConfig;
  defaultUserId: string;
  userId: string;
  context: Pick<FlagContext, 'organization_id' | 'attributes'>;
  serverValues: Record<string, boolean>;
}

function loadStoredOverrides(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(OVERRIDE_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
  } catch (e) {
    console.warn('[Demo] Failed to load overrides:', e);
    return {};
  }
}

function saveOverrides(overrides: Record<string, boolean>): void {
  try {
    if (Object.keys(overrides).length > 0) {
      localStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
    } else {
      localStorage.removeItem(OVERRIDE_STORAGE_KEY);
    }
  } catch (e) {
    console.warn('[Demo] Failed to save overrides:', e);
  }
}

function setUserCookie(userId: string | null): void {
  // Lets the server-side middleware evaluate for the same user on the next request.
  document.cookie = userId
    ? `${USER_COOKIE}=${encodeURIComponent(userId)}; path=/; SameSite=Lax`
    : `${USER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function startDemo(): void {
  const root = document.getElementById('demo');
  const panelRoot = document.getElementById('flag-panel-root');
  if (!root || !panelRoot) return;

  const state = JSON.parse(root.dataset.state ?? '{}') as InitialState;
  const flagKeys = Object.keys(state.serverValues);
  const serverValues: Record<string, boolean> = { ...state.serverValues };
  let userId: string | null = state.userId;

  const client = new FlagClient({
    ...state.config,
    enableRealtime: true,
    enableTelemetry: true,
    onError: (error) => console.error('[Demo] Savvagent error:', error),
  });
  client.setUserId(userId);
  client.setOverrides(loadStoredOverrides());

  const context = (): FlagContext => ({
    ...state.context,
    ...(userId ? { user_id: userId } : {}),
  });

  // ---- Feature cards -------------------------------------------------------

  function renderCard(flagKey: string, value: boolean): void {
    const card = root!.querySelector<HTMLElement>(`.feature-card[data-flag="${flagKey}"]`);
    if (!card) return;
    const overridden = client.hasOverride(flagKey);
    const status = card.querySelector<HTMLElement>('.status')!;
    status.className = `status ${value ? 'enabled' : 'disabled'}`;
    status.textContent = value ? 'Enabled' : 'Disabled';
    card.classList.toggle('feature-card-overridden', overridden);
    card.querySelector<HTMLElement>('.override-badge-inline')!.hidden = !overridden;
    const serverValue = card.querySelector<HTMLElement>('.server-value')!;
    serverValue.hidden = !overridden;
    serverValue.querySelector('.server-value-text')!.textContent = serverValues[flagKey]
      ? 'Enabled'
      : 'Disabled';
    if (flagKey === 'new-feature') {
      root!.querySelector<HTMLElement>('.alert-success')!.hidden = !value;
    }
  }

  // Overrides render synchronously; non-overridden flags re-evaluate, and only
  // the latest round of evaluations is applied.
  let generation = 0;
  function refreshFlags(): void {
    const current = ++generation;
    for (const key of flagKeys) {
      const override = client.getOverride(key);
      renderCard(key, override ?? serverValues[key]);
    }
    for (const key of flagKeys) {
      if (client.hasOverride(key)) continue;
      client
        .evaluate(key, context())
        .then((result) => {
          if (current !== generation || client.hasOverride(key)) return;
          serverValues[key] = result.value;
          renderCard(key, result.value);
        })
        .catch((error) => console.error('[Demo] Flag evaluation failed:', error));
    }
  }

  // ---- User section --------------------------------------------------------

  const userIdDisplay = root.querySelector<HTMLElement>('.user-section code')!;
  function setUser(next: string | null): void {
    userId = next;
    client.setUserId(next);
    setUserCookie(next);
    userIdDisplay.textContent = next ?? 'Not set';
    refreshFlags();
  }

  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset
      .action;
    if (action === 'random-user') {
      setUser('user-' + Date.now());
    } else if (action === 'clear-user') {
      setUser(null);
    } else if (action === 'test-error') {
      try {
        throw new Error('Example error for demonstration');
      } catch (error) {
        client.trackError('new-feature', error as Error, context());
        console.error('Action failed:', error);
      }
    }
  });

  // ---- Flag override panel -------------------------------------------------

  let isOpen = false;
  let flags: FlagDefinition[] = [];
  let loading = false;
  let error: string | null = null;

  function renderPanel(): void {
    const overrides = client.getOverrides();
    const count = Object.keys(overrides).length;

    if (!isOpen) {
      panelRoot!.innerHTML = `
        <button type="button" class="flag-panel-trigger" title="Open Flag Override Panel (Ctrl+Shift+F)">
          <span class="flag-icon">&#9873;</span>
          ${count > 0 ? `<span class="override-badge">${count}</span>` : ''}
        </button>`;
      return;
    }

    const items = flags
      .map((flag) => {
        const overridden = client.hasOverride(flag.key);
        const effective = overrides[flag.key] ?? flag.enabled;
        const key = escapeHtml(flag.key);
        const btn = (on: boolean) => {
          const cls = [
            'flag-toggle-btn',
            effective === on && overridden ? 'active' : '',
            effective === on && !overridden ? 'server' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return `<button type="button" class="${cls}" data-set="${on}" data-key="${key}">${on ? 'ON' : 'OFF'}</button>`;
        };
        return `
          <div class="flag-item${overridden ? ' flag-item-overridden' : ''}">
            <div class="flag-info">
              <div class="flag-key">
                ${key}
                ${overridden ? '<span class="override-indicator">OVERRIDDEN</span>' : ''}
              </div>
              <div class="flag-meta">
                <span class="flag-scope flag-scope-${escapeHtml(flag.scope)}">${escapeHtml(flag.scope)}</span>
                <span class="flag-server-value">Server: ${flag.enabled ? 'ON' : 'OFF'}</span>
              </div>
            </div>
            <div class="flag-controls">
              ${btn(true)}
              ${btn(false)}
              ${overridden ? `<button type="button" class="flag-clear-btn" data-clear="${key}" title="Use server value">Reset</button>` : ''}
            </div>
          </div>`;
      })
      .join('');

    let body: string;
    if (loading && flags.length === 0) {
      body = '<div class="flag-panel-loading">Loading flags...</div>';
    } else if (flags.length === 0) {
      body = '<div class="flag-panel-empty">No flags found</div>';
    } else {
      body = `<div class="flag-list">${items}</div>`;
    }

    panelRoot!.innerHTML = `
      <div class="flag-panel-overlay">
        <div class="flag-panel">
          <div class="flag-panel-header">
            <h3>Feature Flag Overrides</h3>
            <div class="flag-panel-actions">
              <button type="button" class="flag-panel-btn flag-panel-btn-secondary" data-panel="refresh"${loading ? ' disabled' : ''}>
                ${loading ? 'Loading...' : 'Refresh'}
              </button>
              <button type="button" class="flag-panel-btn flag-panel-btn-secondary" data-panel="clear-all"${count === 0 ? ' disabled' : ''}>
                Clear All
              </button>
              <button type="button" class="flag-panel-btn flag-panel-btn-close" data-panel="close">&times;</button>
            </div>
          </div>
          <p class="flag-panel-hint">
            Toggle flags locally for testing. Changes apply immediately.
            Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to toggle panel.
          </p>
          ${error ? `<div class="flag-panel-error">${escapeHtml(error)}</div>` : ''}
          ${body}
          <div class="flag-panel-footer">
            <span class="override-count">${count} override${count !== 1 ? 's' : ''} active</span>
            <span class="flag-panel-note">Overrides persist across page reloads.</span>
          </div>
        </div>
      </div>`;
  }

  async function fetchFlags(): Promise<void> {
    loading = true;
    error = null;
    renderPanel();
    try {
      flags = await client.getAllFlags(client.getEnvironment());
    } catch (e) {
      error = 'Failed to fetch flags';
      console.error('[Demo] Error fetching flags:', e);
    } finally {
      loading = false;
      renderPanel();
    }
  }

  function setOpen(open: boolean): void {
    isOpen = open;
    renderPanel();
    if (open) void fetchFlags();
  }

  panelRoot.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.flag-panel-trigger')) return setOpen(true);
    if (target.classList.contains('flag-panel-overlay')) return setOpen(false);

    const button = target.closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const { panel, set, key, clear } = button.dataset;
    if (panel === 'close') setOpen(false);
    else if (panel === 'refresh') void fetchFlags();
    else if (panel === 'clear-all') client.clearAllOverrides();
    else if (set !== undefined && key) client.setOverride(key, set === 'true');
    else if (clear) client.clearOverride(clear);
  });

  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.key === 'F') {
      event.preventDefault();
      setOpen(!isOpen);
    }
  });

  client.onOverrideChange(() => {
    saveOverrides(client.getOverrides());
    renderPanel();
    refreshFlags();
  });

  // Realtime: re-evaluate when a flag changes on the server.
  for (const key of flagKeys) {
    client.subscribe(key, refreshFlags);
  }

  renderPanel();
  refreshFlags();
}
