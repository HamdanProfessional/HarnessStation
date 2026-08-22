/**
 * The frontend half of the hang watchdog.
 *
 * Rust pings; this answers. Silence means the webview's thread has stopped
 * running JavaScript at all, which is the one failure mode nothing inside the
 * page can report on — see src-tauri/src/watchdog.rs.
 *
 * The answer has to be as close to free as possible. If replying were expensive
 * it would contribute to the very stalls it is meant to detect.
 */

import { isWeb } from "./web";

/**
 * Turn the raw marker into a sentence.
 *
 * Separated from the IO so the wording, the plural and the "how long" arithmetic
 * can be tested without a filesystem or a backend.
 */
export interface HangReport {
  at: number;
  silentMs: number;
  version?: string;
}

export function parseHangReport(raw: string | null | undefined): HangReport | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (typeof j?.at !== "number" || typeof j?.silentMs !== "number") return null;
    return { at: j.at, silentMs: j.silentMs, version: typeof j.version === "string" ? j.version : undefined };
  } catch {
    return null;
  }
}

/**
 * What the user is told after a hang.
 *
 * Deliberately does not say "crashed": nothing crashed, and telling someone
 * their app crashed when their data is intact reads worse than what happened.
 */
export function describeHang(r: HangReport): string {
  const secs = Math.max(1, Math.round(r.silentMs / 1000));
  return `HarnessStation stopped responding for ${secs} second${secs === 1 ? "" : "s"} and restarted itself. Your chats were saved.`;
}

let stop: (() => void) | null = null;

/**
 * Start answering pings, and report a hang from the previous run if there was
 * one. Safe to call more than once.
 */
export async function installWatchdog(onHang: (message: string) => void): Promise<void> {
  if (isWeb() || stop) return;
  try {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);

    const un = await listen("watchdog-ping", () => void invoke("watchdog_pong").catch(() => {}));
    stop = un;

    // Start the clock immediately. Until the first answer Rust only has the
    // timestamp it set at startup, and a slow boot would eat into the grace
    // period for no reason.
    await invoke("watchdog_pong").catch(() => {});

    const report = parseHangReport(await invoke<string | null>("take_hang_report").catch(() => null));
    if (report) onHang(describeHang(report));
  } catch {
    /* older backend without the commands — the app runs unwatched, as before */
  }
}
