import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The web build of HarnessStation.
 *
 * Reuses the desktop app's entire src/ tree. The only thing that differs is
 * here: every @tauri-apps/* import is aliased to a browser shim under web/shims,
 * so the same React code that calls a Rust backend on the desktop calls
 * browser APIs (OPFS, fetch, getUserMedia, …) on the web. There is no fork.
 *
 *   npm run web:dev
 *   npm run web:build      # static site -> web/dist
 */
const shim = (name: string) => resolve(__dirname, "shims", name);

export default defineConfig({
  root: __dirname,
  base: process.env.WEB_BASE || "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@tauri-apps/api/core": shim("core.ts"),
      "@tauri-apps/api/event": shim("event.ts"),
      "@tauri-apps/plugin-fs": shim("fs.ts"),
      "@tauri-apps/plugin-http": shim("http.ts"),
      "@tauri-apps/plugin-opener": shim("opener.ts"),
      "@tauri-apps/plugin-updater": shim("updater.ts"),
      "@tauri-apps/plugin-process": shim("updater.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: { port: 5175 },
});
