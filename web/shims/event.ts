/**
 * Events, standing in for @tauri-apps/api/event.
 *
 * The desktop app listens for events the Rust side emits — download progress,
 * tray clicks, push-to-talk, mesh requests. None of those exist in the browser,
 * so listeners are registered against a local bus and simply never fire, which
 * is the correct behaviour: the features that would emit them aren't present.
 *
 * `emit` is kept as a real local dispatch so any in-app, same-window use keeps
 * working; cross-process emits (from Rust) have no source here.
 */

export type UnlistenFn = () => void;

type Handler = (event: { payload: unknown }) => void;
const listeners = new Map<string, Set<Handler>>();

export async function listen(name: string, handler: Handler): Promise<UnlistenFn> {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(handler);
  return () => set!.delete(handler);
}

export async function emit(name: string, payload?: unknown): Promise<void> {
  listeners.get(name)?.forEach((h) => h({ payload }));
}
