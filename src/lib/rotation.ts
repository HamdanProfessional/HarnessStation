/**
 * Round-robin between providers that serve the same model.
 *
 * Several connected providers often list the identical model id — Groq,
 * Cerebras, Together and Fireworks all serve `llama-3.3-70b`, and every one of
 * them rate-limits a free key separately. The app's existing rule is "first
 * provider that lists it", so all the load lands on whichever happens to sort
 * first and the other keys sit idle until that one starts returning 429s.
 *
 * Rotation only ever picks between providers that advertise the *same model id*,
 * so the answer comes from the same weights whichever way the cursor lands. It
 * is not a fallback mechanism and not a router: it does not retry, it does not
 * substitute a different model, and it never overrides a provider the user
 * pinned explicitly. Those are separate features with separate failure modes.
 */

import type { Provider } from "./types";

/** Cursor state, one counter per model id. Callers own it so this stays pure. */
export type Cursors = Record<string, number>;

/**
 * Providers that can actually serve `model`, in stable order.
 *
 * "Can serve" means it lists the model *and* is usable — a provider with no key
 * would 401, and rotating onto it would turn a working setup into an
 * intermittently failing one, which is far worse than an unbalanced one. Local
 * providers need no key.
 */
export function candidatesFor(model: string, providers: Provider[]): Provider[] {
  return providers.filter(
    (p) => p.models.includes(model) && (p.apiKey.trim().length > 0 || isKeyless(p)),
  );
}

/** Local servers (Ollama, LM Studio, llama.cpp) authenticate with nothing. */
function isKeyless(p: Provider): boolean {
  return p.id === "local" || /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(p.baseUrl);
}

/**
 * Pick the next provider for `model` and return the advanced cursor.
 *
 * Returns `null` when nothing can serve the model — the caller keeps whatever
 * resolution it would have used anyway, so turning rotation on can never take
 * away a provider the old code would have found.
 */
export function nextProvider(
  model: string,
  providers: Provider[],
  cursors: Cursors,
): { provider: Provider; cursors: Cursors } | null {
  const pool = candidatesFor(model, providers);
  if (pool.length === 0) return null;
  // One candidate is not a rotation. Return it without touching the cursor, so
  // adding a second provider later starts from the top rather than mid-cycle.
  if (pool.length === 1) return { provider: pool[0], cursors };

  const at = (cursors[model] ?? 0) % pool.length;
  return { provider: pool[at], cursors: { ...cursors, [model]: (at + 1) % pool.length } };
}

/**
 * Process-wide cursors for callers that have nowhere to put them.
 *
 * Deliberately not persisted: which provider served the last turn is worth
 * nothing after a restart, and writing it to settings on every request would
 * mean a disk write per message.
 */
let live: Cursors = {};

export function rotate(model: string, providers: Provider[]): Provider | null {
  const step = nextProvider(model, providers, live);
  if (!step) return null;
  live = step.cursors;
  return step.provider;
}


/**
 * Every usable key on a provider, main key first.
 *
 * A keyless (local) provider still yields one empty entry, so callers get
 * exactly one attempt rather than none.
 */
export function keysOf(p: Provider): string[] {
  const keys = [p.apiKey, ...(p.apiKeys ?? [])].map((k) => (k ?? "").trim()).filter(Boolean);
  return keys.length ? keys : [""];
}

/**
 * Rotate a provider's keys so a different one leads each request.
 *
 * The existing failover already walks every key, but always starting at the
 * first — so key 1 absorbs all traffic until it rate-limits and the spares sit
 * unused. Rotating the *starting point* spreads the load while keeping the rest
 * of the list intact behind it, so a failed attempt still falls through to
 * every other key exactly as before.
 */
export function nextKeyOrder(
  providerId: string,
  keys: string[],
  cursors: Cursors,
): { keys: string[]; cursors: Cursors } {
  if (keys.length < 2) return { keys, cursors };
  const slot = `key:${providerId}`;
  const at = (cursors[slot] ?? 0) % keys.length;
  return {
    keys: [...keys.slice(at), ...keys.slice(0, at)],
    cursors: { ...cursors, [slot]: (at + 1) % keys.length },
  };
}

/** Process-wide key rotation. Returns the provider with its keys reordered. */
export function rotateKeys(p: Provider): Provider {
  const step = nextKeyOrder(p.id, keysOf(p), live);
  if (step.keys.length < 2) return p;
  live = step.cursors;
  return { ...p, apiKey: step.keys[0], apiKeys: step.keys.slice(1) };
}

/** Test seam — resets the module-level cursors. */
export function resetRotation(): void {
  live = {};
}
