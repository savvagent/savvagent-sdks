import type { Config } from '@react-router/dev/config';

export default {
  // Server-side rendering, so flags are evaluated in the root loader and
  // hydrated into the client provider.
  ssr: true,
} satisfies Config;
