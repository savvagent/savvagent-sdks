// Shared by astro.config.mjs (server-side client used by the middleware) and
// the page (browser client). SDK keys start with `sdk_` and are safe to ship
// to the browser.
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
