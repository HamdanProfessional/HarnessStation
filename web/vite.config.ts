import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The web build of HarnessStation.
 *
 * Reuses the desktop app's entire src/ tree. Two mechanisms adapt it to the
 * browser, both here so the app code stays unforked:
 *
 *   - resolve.alias points every @tauri-apps/* import at a browser shim.
 *   - redirectModules() redirects specific relative modules (whisper.ts) whose
 *     engine can't run in a browser to a shim that keeps the same public API.
 *
 *   npm run web:dev
 *   npm run web:build      # static site -> web/dist
 */
const shim = (name: string) => resolve(__dirname, "shims", name);

/** Desktop modules that need a browser reimplementation, keyed by path suffix. */
const REDIRECTS: Record<string, string> = {
  "src/lib/whisper.ts": shim("whisper.ts"),
};

function redirectModules() {
  const norm = (p: string) => p.split("\\").join("/");
  return {
    name: "harness-web-redirects",
    async resolveId(
      this: { resolve: (s: string, i?: string, o?: object) => Promise<{ id: string } | null> },
      source: string,
      importer: string | undefined,
    ) {
      // The shim itself re-exports the original's pure helpers — don't redirect that.
      if (importer && norm(importer).endsWith("/web/shims/whisper.ts")) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return null;
      for (const [suffix, target] of Object.entries(REDIRECTS)) {
        if (norm(resolved.id).endsWith(suffix)) return target;
      }
      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: process.env.WEB_BASE || "/",
  plugins: [redirectModules(), react()],
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
