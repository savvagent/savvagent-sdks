/**
 * @savvagent/nextjs - Next.js SDK for Savvagent feature flags
 *
 * This package provides Next.js-specific integrations including:
 * - Client Components (hooks and provider)
 * - Server Components (async flag evaluation)
 * - Middleware (edge runtime support)
 * - Route Handlers and Server Actions
 *
 * @packageDocumentation
 */

/**
 * For Client Components, import from '@savvagent/nextjs/client':
 *
 * ```tsx
 * 'use client';
 * import { useFlag, SavvagentProvider } from '@savvagent/nextjs/client';
 * ```
 *
 * For Server Components, import from '@savvagent/nextjs/server':
 *
 * ```tsx
 * import { isEnabled, evaluate } from '@savvagent/nextjs/server';
 * ```
 *
 * For Middleware, import from '@savvagent/nextjs/middleware':
 *
 * ```tsx
 * import { createMiddleware } from '@savvagent/nextjs/middleware';
 * ```
 */

// Default exports (server-side by default for App Router)
export {
  initServerClient,
  getServerClient,
  createServerContext,
  isEnabled,
  evaluate,
  withFlag,
  trackError,
  evaluateForRequest,
} from './server';

// Re-export types
export type {
  FlagClientConfig,
  FlagContext,
  FlagEvaluationResult,
  EvaluationEvent,
  ErrorEvent,
  FlagUpdateEvent,
} from '@savvagent/sdk';
