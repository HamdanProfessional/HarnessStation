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
let summon: (() => void) | null = null;

/** Called by the pane component on mount; pass null on unmount. */
export function registerPane(fn: PaneOpener | null): void {
  opener = fn;
}

/**
 * How the tools ask for a browser when none is on screen.
 *
 * Registered once by the app, and wired to whatever makes the browser card
 * appear. Without it, a model calling open_url with the card closed would
 * navigate a webview nobody could see, then report success — which is exactly
 * what it did.
 */
export function registerPaneRequester(fn: (() => void) | null): void {
  summon = fn;
}

export function paneMounted(): boolean {
  return opener !== null;
}

/** Ask for a browser and wait for it to mount. Returns false if none appears. */
export async function requestPage(url: string): Promise<boolean> {
  if (!opener && summon) {
    summon();
    // Mounting is a React render away, not instant. Poll briefly rather than
    // guess at a delay.
    for (let i = 0; i < 40 && !opener; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!opener) return false;
  await opener(url);
  return true;
}
