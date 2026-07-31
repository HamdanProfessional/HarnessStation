/**
 * Test environment shims.
 *
 * The lib modules are written for the Tauri webview, so a couple of browser
 * globals have to exist before any of them is imported. Nothing here fakes app
 * behaviour — only the platform surface the code assumes is present.
 */
import { beforeEach, vi } from "vitest";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

globalThis.localStorage = new MemoryStorage();

/** Minimal HTMLAudioElement: the TTS queue plays generated audio through it. */
class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = true;
  constructor(public src?: string) {}
  play(): Promise<void> {
    this.paused = false;
    setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
}

globalThis.Audio = FakeAudio as unknown as typeof Audio;

// The lib code is written for the Tauri webview and reaches for `window` (timers,
// event listeners). Node has the timers on globalThis already — alias it and fill
// in the DOM-only bits the modules under test touch.
const g = globalThis as unknown as Record<string, unknown>;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.window ??= globalThis;

// Tauri's invoke() talks to window.__TAURI_INTERNALS__, which doesn't exist here.
// Tests that care about a command mock it themselves; this keeps the rest quiet.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    throw new Error("tauri invoke not available in tests");
  }),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(async () => {
    throw new Error("network not available in tests");
  }),
}));

beforeEach(() => {
  localStorage.clear();
});
