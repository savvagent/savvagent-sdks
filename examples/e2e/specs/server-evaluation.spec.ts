import type { Response } from '@playwright/test';
import { test, expect } from '../fixtures';

/**
 * The server path: the app evaluates `server-demo` on its server through
 * the framework's server SDK (@savvagent/nextjs/server with its middleware,
 * or @savvagent/sveltekit) against the mock Flags API, which echoes the
 * identifiers it received. Runs only for apps with `serverFlags`.
 */

const ANONYMOUS_ID = /^anon_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ANONYMOUS_COOKIE = /^savvagent_anonymous_id=([^;]*)(;.*)?$/i;

/** The `savvagent_anonymous_id` Set-Cookie headers of a response. */
async function anonymousIdCookies(response: Response): Promise<string[]> {
  return (await response.headersArray())
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .flatMap((header) => header.value.split('\n'))
    .filter((cookie) => ANONYMOUS_COOKIE.test(cookie.trim()));
}

/**
 * The text of a data-testid element in raw server HTML. Comments (React and
 * Svelte hydration markers) are stripped first, so they cannot split the text.
 */
function testIdText(html: string, testId: string): string | undefined {
  const match = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(html.replace(/<!--[\s\S]*?-->/g, ''));
  return match?.[1].trim();
}

test.describe('Server-side evaluation', () => {
  test.beforeEach(async ({ appConfig }) => {
    test.skip(!appConfig.serverFlags, `${appConfig.name} has no server-side flag evaluation`);
  });

  test('renders the server-evaluated flag in the initial HTML', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);
    const html = await response!.text();

    // In the document the server sent, before any client-side JavaScript runs.
    expect(testIdText(html, 'server-flag-value')).toBe('enabled');
    expect(testIdText(html, 'server-flag-reason')).toBe('evaluated');

    await expect(page.getByTestId('server-flag-value')).toHaveText('enabled');
  });

  test('sets the anonymous ID cookie on the first response and evaluates with it', async ({ page, context }) => {
    const response = await page.goto('/');
    const cookies = await anonymousIdCookies(response!);
    expect(cookies).toHaveLength(1);

    const [, encoded, attributes = ''] = ANONYMOUS_COOKIE.exec(cookies[0].trim())!;
    const anonymousId = decodeURIComponent(encoded);
    expect(anonymousId).toMatch(ANONYMOUS_ID);
    expect(attributes).toMatch(/;\s*Path=\/(;|$)/i);
    expect(attributes).toMatch(/;\s*SameSite=Lax(;|$)/i);
    expect(attributes).toMatch(/;\s*Max-Age=31536000(;|$)/i);
    expect(attributes).not.toMatch(/HttpOnly/i);
    // http://localhost, so not Secure.
    expect(attributes).not.toMatch(/;\s*Secure(;|$)/i);

    // The server evaluated with the ID it set, in the same request.
    expect(testIdText(await response!.text(), 'server-anonymous-id')).toBe(anonymousId);
    await expect(page.getByTestId('server-anonymous-id')).toHaveText(anonymousId);

    // The browser stored it, and a later request keeps it without a new cookie.
    const stored = (await context.cookies()).find((cookie) => cookie.name === 'savvagent_anonymous_id');
    expect(stored?.value).toBe(anonymousId);
    expect(stored?.httpOnly).toBe(false);

    const reload = await page.reload();
    expect(await anonymousIdCookies(reload!)).toHaveLength(0);
    await expect(page.getByTestId('server-anonymous-id')).toHaveText(anonymousId);
  });

  test('evaluates with an existing anonymous ID cookie and sets none', async ({ page, context, baseURL }) => {
    const existing = 'anon_00000000-0000-4000-8000-000000000029';
    await context.addCookies([{ name: 'savvagent_anonymous_id', value: existing, url: baseURL! }]);

    const response = await page.goto('/');
    expect(await anonymousIdCookies(response!)).toHaveLength(0);
    expect(testIdText(await response!.text(), 'server-anonymous-id')).toBe(existing);
  });

  test('does not trust a forged user_id cookie', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'user_id', value: 'forged-admin', url: baseURL! }]);

    const response = await page.goto('/');
    const html = await response!.text();

    // The Flags API received no user_id, only the visitor's anonymous ID.
    expect(testIdText(html, 'server-flag-reason')).toBe('evaluated');
    expect(testIdText(html, 'server-user-id')).toBe('(none)');
    expect(testIdText(html, 'server-anonymous-id')).toMatch(ANONYMOUS_ID);
    expect(html).not.toContain('forged-admin');
  });
});
