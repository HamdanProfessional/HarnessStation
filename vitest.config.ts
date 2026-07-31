import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the Tauri dev-server settings (fixed port,
// strictPort) have nothing to do with tests and would fail a parallel run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
