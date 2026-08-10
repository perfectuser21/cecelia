/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_N8N_WEBHOOK_BASE: string
  readonly VITE_N8N_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
