import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The documentation site.
 *
 * A separate Vite app from the desktop harness, sharing the repo's dependencies
 * rather than carrying its own — the docs use the same react-markdown and
 * highlight.js the app does, so the rendering genuinely matches instead of
 * merely resembling.
 *
 * Run from the repo root: `npm run docs:dev` / `npm run docs:build`.
 */
export default defineConfig({
  root: __dirname,
  /*
   * Absolute asset URLs, and this must stay absolute.
   *
   * A relative base ("./") looks more portable but silently breaks clean URLs:
   * from /guide/tools the browser resolves ./assets/index.js against /guide/,
   * asks for /guide/assets/index.js, and the SPA fallback hands back index.html
   * with a text/html type. The script never runs and the page is blank — with a
   * 200 in the network tab, which is why it's easy to miss.
   *
   * To deploy under a sub-path, set DOCS_BASE (e.g. DOCS_BASE=/docs/).
   */
  base: process.env.DOCS_BASE || "/",
  plugins: [
    react(),
    {
      // Clean URLs need every unknown path to serve the app shell. In dev Vite
      // does that already; in production it's the host's job, and a 404.html is
      // what GitHub Pages, Netlify and Cloudflare all honour.
      name: "spa-fallback-404",
      closeBundle() {
        const out = resolve(__dirname, "dist");
        try {
          writeFileSync(resolve(out, "404.html"), readFileSync(resolve(out, "index.html")));
        } catch {
          /* nothing built (e.g. a type-check-only run) */
        }
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: { port: 5174 },
});
