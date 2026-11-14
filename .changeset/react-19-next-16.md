---
'@savvagent/react': minor
'@savvagent/nextjs': minor
---

Support React 19 and Next.js 16. The peer ranges are widened to `react >=16.8.0 <20` for `@savvagent/react`, and to `next >=13.0.0 <17` and `react >=18.0.0 <20` for `@savvagent/nextjs`. Lower bounds are unchanged. Both packages are now built and unit-tested against React 19.3 (and Next 16.4 for `@savvagent/nextjs`). The `@savvagent/nextjs/server` and `@savvagent/nextjs/middleware` entries are covered only by unit tests that mock `next/headers` and `next/server`; end-to-end coverage is tracked in #29.
