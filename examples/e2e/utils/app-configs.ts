export interface AppConfig {
  name: string;
  directory: string;
  port: number;
  devCommand: string;
  envPrefix: 'VITE_' | 'NEXT_PUBLIC_' | '';
  framework: 'react' | 'nextjs' | 'angular' | 'vue' | 'svelte' | 'sveltekit' | 'astro' | 'remix' | 'solid';
  isSSR: boolean;
  startupTimeout: number;
}

export const APP_CONFIGS: Record<string, AppConfig> = {
  'react-app': {
    name: 'React',
    directory: 'react-app',
    port: 3000,
    devCommand: 'pnpm dev',
    envPrefix: 'VITE_',
    framework: 'react',
    isSSR: false,
    startupTimeout: 30000,
  },
  'nextjs-app': {
    name: 'Next.js',
    directory: 'nextjs-app',
    port: 3001,
    devCommand: 'pnpm dev',
    envPrefix: 'NEXT_PUBLIC_',
    framework: 'nextjs',
    isSSR: true,
    startupTimeout: 45000,
  },
  'angular-app': {
    name: 'Angular',
    directory: 'angular-app',
    port: 3001,
    devCommand: 'pnpm dev',
    envPrefix: '',
    framework: 'angular',
    isSSR: false,
    startupTimeout: 60000,
  },
  'vue-app': {
    name: 'Vue',
    directory: 'vue-app',
    port: 5174,
    devCommand: 'pnpm dev',
    envPrefix: 'VITE_',
    framework: 'vue',
    isSSR: false,
    startupTimeout: 30000,
  },
  'svelte-app': {
    name: 'Svelte',
    directory: 'svelte-app',
    port: 5176,
    devCommand: 'pnpm dev',
    envPrefix: 'VITE_',
    framework: 'svelte',
    isSSR: false,
    startupTimeout: 30000,
  },
  'sveltekit-app': {
    name: 'SvelteKit',
    directory: 'sveltekit-app',
    port: 5177,
    devCommand: 'pnpm dev',
    envPrefix: 'VITE_',
    framework: 'sveltekit',
    isSSR: true,
    startupTimeout: 45000,
  },
  'astro-app': {
    name: 'Astro',
    directory: 'astro-app',
    port: 4321,
    devCommand: 'pnpm dev',
    envPrefix: '',
    framework: 'astro',
    isSSR: true,
    startupTimeout: 30000,
  },
  'remix-app': {
    name: 'Remix',
    directory: 'remix-app',
    port: 5178,
    devCommand: 'pnpm dev',
    envPrefix: 'VITE_',
    framework: 'remix',
    isSSR: true,
    startupTimeout: 45000,
  },
  'solid-app': {
    name: 'SolidJS',
    directory: 'solid-app',
    port: 5175,
    devCommand: 'pnpm dev',
    envPrefix: 'VITE_',
    framework: 'solid',
    isSSR: false,
    startupTimeout: 30000,
  },
};

export const BETA_ENV = {
  SAVVAGENT_API_URL: 'https://flags-api-beta.savvagent.com',
  SAVVAGENT_SDK_KEY: 'sdk_dev_ca6aeb1de1308034e5fcb23db66cb35f',
  VITE_SAVVAGENT_API_URL: 'https://flags-api-beta.savvagent.com',
  VITE_SAVVAGENT_SDK_KEY: 'sdk_dev_ca6aeb1de1308034e5fcb23db66cb35f',
  NEXT_PUBLIC_SAVVAGENT_API_URL: 'https://flags-api-beta.savvagent.com',
  NEXT_PUBLIC_SAVVAGENT_SDK_KEY: 'sdk_dev_ca6aeb1de1308034e5fcb23db66cb35f',
};
