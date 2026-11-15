// Savvagent client config, read at server runtime: astro.config.mjs passes
// this file to the integration as `configModule`, so the middleware imports
// it when the server starts (process.env is read then, not at build time)
// and function options such as onError are kept.
export const savvagentConfig = {
  applicationId: 'f8209ef5-a661-4f46-8b84-4c855a97d5ef',
  environment: 'development',
  defaults: {
    'new-feature': false,
    'beta-feature': false,
    'enterprise-one': false,
  },
};

/**
 * Settings the browser client needs; the page sends them to the browser. The
 * key must be a public client SDK key (`sdk_...`): it is visible to every
 * visitor. It is read from its own variable, never from the server's key.
 */
export function browserConfig() {
  return {
    ...savvagentConfig,
    apiKey: process.env.PUBLIC_SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
    // Never the server's SAVVAGENT_API_URL: it can be an internal address.
    baseUrl: process.env.PUBLIC_SAVVAGENT_API_URL || 'https://api.savvagent.com/flags',
  };
}

// The server-side client (Astro.locals.savvagent).
export default {
  ...savvagentConfig,
  apiKey: process.env.SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
  baseUrl: process.env.SAVVAGENT_API_URL || 'https://api.savvagent.com/flags',
  onError: (error) => console.error('[Astro example] Savvagent error:', error),
};
