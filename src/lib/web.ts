/**
 * Web-build capability helpers.
 *
 * The browser build shares the entire UI with the desktop app, but some features
 * only exist on the desktop (a native local-model runner, the device mesh, the
 * in-app browser, OS keychain). These helpers let a view detect that it's on the
 * web and, when a feature can't work here, point the user to the desktop app
 * instead of failing silently.
 */

/** True in the browser build (set by web/main.tsx). */
export function isWeb(): boolean {
  return !!(globalThis as unknown as { __HS_WEB__?: boolean }).__HS_WEB__;
}

/** WebGPU is required to run a model in the tab (WebLLM). */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Where "Get the desktop app" links point. Overridable at build time. */
export const DESKTOP_URL =
  (import.meta.env.VITE_DESKTOP_URL as string | undefined)?.trim() ||
  "https://hsdocs.retris.io/start/install";

/**
 * Features that only work in the desktop app, with a one-line reason. Used by the
 * <GetDesktopApp> advert so every "not on web" message reads the same way.
 */
export const DESKTOP_ONLY: Record<string, string> = {
  "local-models":
    "Downloading and running full local models (llama.cpp, any GGUF from Hugging Face) needs the desktop app. In the browser you can run small models on WebGPU instead.",
  mesh: "The device mesh links your machines over your network — that needs the desktop app on each one.",
  browser: "Driving your real browser as a tool needs the desktop app and its extension.",
  keychain: "Storing keys in the OS keychain needs the desktop app; the web build keeps them in this browser's storage.",
};
