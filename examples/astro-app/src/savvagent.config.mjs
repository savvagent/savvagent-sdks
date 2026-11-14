// Savvagent client config, read at server runtime: astro.config.mjs passes
// this file to the integration as `configModule`, so the middleware imports
// it when the server starts (process.env is read then, not at build time)
// and function options such as onError are kept. The page also reuses it for
// the browser client; SDK keys start with `sdk_` and are safe to ship there.
export const savvagentConfig = {
  apiKey: process.env.SAVVAGENT_SDK_KEY || 'sdk_your_key_here',
  baseUrl: process.env.SAVVAGENT_API_URL || 'https://api.savvagent.com/flags',
  applicationId: 'f8209ef5-a661-4f46-8b84-4c855a97d5ef',
  environment: 'development',
  defaults: {
    'new-feature': false,
    'beta-feature': false,
    'enterprise-one': false,
  },
};

export default {
  ...savvagentConfig,
  onError: (error) => console.error('[Astro example] Savvagent error:', error),
};
