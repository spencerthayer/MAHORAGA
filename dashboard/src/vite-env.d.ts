/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAHORAGA_API_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
