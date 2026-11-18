/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAVVAGENT_FLAGS_API_URL: string;
  readonly VITE_SAVVAGENT_FLAGS_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
