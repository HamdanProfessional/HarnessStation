import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        // Name the big lazy chunks after what they are.
        //
        // Rollup otherwise names them `index-<hash>.js`, which is how the 6 MB
        // web-llm chunk got read as the *entry* chunk and written into
        // docs/freeze.md as a constraint justifying which features to stop
        // building. The entry is 774 kB; web-llm is lazy and is fetched only if
        // someone runs a model in the tab. This changes no bytes — same content,
        // same hash — it only makes the build log say which is which.
        manualChunks(id) {
          if (id.includes("@mlc-ai/web-llm")) return "web-llm";
          return undefined;
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
