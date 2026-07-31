/**
 * Which OS we're on. Resolved once from the Rust side at startup; everything that
 * downloads a binary or shells out to a system tool branches on this.
 */
import { invoke } from "@tauri-apps/api/core";

export type OsName = "windows" | "linux" | "macos" | "unknown";

let cached: OsName = "unknown";

export async function detectOs(): Promise<OsName> {
  try {
    const os = await invoke<string>("platform");
    cached = os === "windows" || os === "linux" || os === "macos" ? os : "unknown";
  } catch {
    // Fall back to the user agent so a stale backend doesn't break asset selection.
    const ua = navigator.userAgent.toLowerCase();
    cached = ua.includes("windows") ? "windows" : ua.includes("linux") ? "linux" : ua.includes("mac") ? "macos" : "unknown";
  }
  return cached;
}

/** Synchronous read of the value resolved at startup. */
export function os(): OsName {
  return cached;
}

export const isWindows = () => cached === "windows";
export const isLinux = () => cached === "linux";

/** Executable file name for the current platform. */
export function exeName(base: string): string {
  return cached === "windows" ? `${base}.exe` : base;
}
