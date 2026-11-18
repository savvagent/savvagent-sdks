// A stand-in Flags API for the server-side E2E path.
//
// Playwright can intercept the browser's requests but not the ones an app's
// server makes, so the Next.js and SvelteKit examples point their server
// client (SAVVAGENT_FLAGS_API_URL) here during E2E. The browser SDK keeps
// using the real API, as before.
//
// POST /api/flags/<key>/evaluate answers with the REST evaluate contract
// (`enabled`, `key`, ...). `server-demo` is enabled and every other flag is
// disabled. `configuration.received` echoes the identifiers the SDK sent, so
// a page can render the context the server evaluated with and a test can
// assert on it. A request without exactly `Bearer $MOCK_FLAGS_API_KEY`
// (401), without `Content-Type: application/json` (415) or without a
// `context` object (400) is refused, so a broken env path fails the tests.
//
// Started by examples/playwright.config.ts; run it alone with
// `MOCK_FLAGS_API_KEY=<key> node e2e/mock-flags-api.mjs` (port:
// MOCK_FLAGS_API_PORT, default 5190).

import { createServer } from 'node:http';

const port = Number(process.env.MOCK_FLAGS_API_PORT || 5190);
// The only key accepted; the config passes the one the apps' server clients get.
const API_KEY = process.env.MOCK_FLAGS_API_KEY;
const ENABLED_FLAGS = new Set(['server-demo']);
const EVALUATE_PATH = /^\/api\/flags\/([A-Za-z0-9._-]{1,128})\/evaluate$/;
const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    send(res, 200, { status: 'ok' });
    return;
  }

  const match = req.method === 'POST' ? EVALUATE_PATH.exec(url.pathname) : null;
  if (!match) {
    // Telemetry and anything else the server client may send: accepted, ignored.
    if (req.method === 'POST') {
      req.resume();
      send(res, 202, { accepted: true });
    } else {
      send(res, 404, { error: 'not found' });
    }
    return;
  }

  if (!API_KEY || req.headers.authorization !== `Bearer ${API_KEY}`) {
    send(res, 401, { error: 'missing or wrong bearer key' });
    return;
  }
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    send(res, 415, { error: 'Content-Type must be application/json' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: 'invalid JSON body' });
    return;
  }
  const context = payload?.context;
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    send(res, 400, { error: 'body must be {"context": {...}}' });
    return;
  }

  const key = match[1];
  send(res, 200, {
    key,
    enabled: ENABLED_FLAGS.has(key),
    variation: null,
    scope: 'application',
    configuration: {
      received: {
        anonymous_id: typeof context.anonymous_id === 'string' ? context.anonymous_id : null,
        user_id: typeof context.user_id === 'string' ? context.user_id : null,
      },
    },
    timestamp: new Date().toISOString(),
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock Flags API listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
