/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Gateway that serves the shared third-party data (benchmarks, MCP directory).
   * Set when building a release so the app needs no API key of its own:
   *   VITE_GATEWAY_URL=https://gateway.example.com npm run tauri build
   * Left empty in dev, where the app falls back to direct calls.
   */
  readonly VITE_GATEWAY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
