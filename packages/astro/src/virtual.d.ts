declare module 'virtual:@savvagent/astro/config' {
  import type { FlagClientConfig } from '@savvagent/sdk';
  import type { GetUserId, SavvagentIntegrationOptions } from './index';
  const config: FlagClientConfig;
  export default config;
  /** The configModule's named `getUserId` export, if any. */
  export const getUserId: GetUserId | undefined;
  /** JSON-serializable integration options needed at runtime. */
  export const options: Pick<SavvagentIntegrationOptions, 'trustUserIdCookie' | 'evaluationTimeoutMs'>;
}
