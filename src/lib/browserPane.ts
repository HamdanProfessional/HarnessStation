/**
 * A tiny registry that lets the browser *tools* ask the browser *pane* to show a
 * page, without either importing the other.
 *
 * The pane is a native child webview positioned over a placeholder in the React
 * layout, so only the mounted component knows where it should go. The tools just
 * say "put this URL on screen" and the pane works out the geometry. When no pane
 * is mounted — the model called open_url while the user is on another view — the
 * tools fall back to driving the webview directly.
 */

export type PaneOpener = (url: string) => Promise<void>;

let opener: PaneOpener | null = null;

/** Called by the pane component on mount; pass null on unmount. */
export function registerPane(fn: PaneOpener | null): void {
  opener = fn;
}

export function paneMounted(): boolean {
  return opener !== null;
}

/** Ask the mounted pane to show a URL. Returns false if there isn't one. */
export async function requestPage(url: string): Promise<boolean> {
  if (!opener) return false;
  await opener(url);
  return true;
}
