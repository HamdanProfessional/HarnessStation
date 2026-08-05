import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts: the Tauri dev-server settings (fixed port,
// strictPort) have nothing to do with tests and would fail a parallel run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // The first executeTool/store test cold-loads a large module graph on demand
    // (store → providers → tools → hooks → …), which can brush past the 5s
    // default in CI/under load. It's import cost, not a hang.
    testTimeout: 20_000,
  },
});
