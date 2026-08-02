/**
 * Opening links/paths, standing in for @tauri-apps/plugin-opener.
 *
 * The desktop version hands a URL to the OS. In the browser a new tab is the
 * honest equivalent; a local file path (which the plugin can also open) has no
 * meaning here, so only http(s) is acted on.
 */

export async function openUrl(url: string): Promise<void> {
  if (/^https?:/i.test(url)) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    console.warn(`[web] cannot open non-URL path: ${url}`);
  }
}

export async function openPath(path: string): Promise<void> {
  console.warn(`[web] cannot open a local path in the browser: ${path}`);
}
