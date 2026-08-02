/**
 * The Tauri command bridge, standing in for @tauri-apps/api/core.
 *
 * Every `invoke("name", args)` in the app crosses here instead of going to Rust.
 * This one file is, in effect, the entire backend for the web build: a command
 * either has a browser implementation, or it doesn't exist here and the call is
 * rejected with a clear reason so the caller can degrade.
 *
 * Commands are added as their browser equivalents land — mic via getUserMedia,
 * speech via transformers.js, files/terminal via an in-browser VM. Until then an
 * unimplemented command fails honestly rather than pretending to work, and the
 * callers that have fallbacks (detectOs → user agent, speech → next engine) take
 * them.
 */

type Args = Record<string, unknown> | undefined;
type Handler = (args: Args) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  // The one thing needed at startup. detectOs also falls back to the user agent,
  // so even this is belt-and-braces.
  platform: () => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes("windows")
      ? "windows"
      : ua.includes("mac")
        ? "macos"
        : ua.includes("linux")
          ? "linux"
          : "unknown";
  },

  // The web build keeps running in one tab; there's no tray to reflect state to.
  set_tray_title: () => null,
  set_background_mode: () => null,
  show_main: () => null,
};

/** Commands we know aren't available in the browser, with a reason worth showing. */
const UNAVAILABLE: Record<string, string> = {
  start_server: "Local model servers can't be launched from a browser — connect a hosted or CORS-enabled endpoint instead.",
  stop_server: "Local model servers can't be launched from a browser.",
  mcp_connect: "stdio MCP servers need a local process; use an HTTP MCP server instead.",
  mesh_start: "The device mesh needs a network listener, which a browser tab can't open.",
  inapp_open: "The in-app browser is a native window; the web build can't embed one.",
};

const warned = new Set<string>();

export async function invoke<T = unknown>(cmd: string, args?: Args): Promise<T> {
  const handler = handlers[cmd];
  if (handler) return (await handler(args)) as T;

  const reason = UNAVAILABLE[cmd] ?? `"${cmd}" isn't available in the web version.`;
  // One line per command, so a feature probing in a loop doesn't flood the console.
  if (!warned.has(cmd)) {
    warned.add(cmd);
    console.info(`[web] ${reason}`);
  }
  throw new Error(reason);
}

/** Register a browser implementation for a command (used as subsystems land). */
export function registerCommand(cmd: string, handler: Handler): void {
  handlers[cmd] = handler;
}

// The app occasionally imports these names from api/core; harmless stubs keep
// those imports resolving.
export function transformCallback(cb: unknown): number {
  void cb;
  return 0;
}

export const convertFileSrc = (path: string): string => path;
