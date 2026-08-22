/**
 * Round-robin between the API keys on one provider.
 *
 * Providers rate-limit per key, so a second key on the same account is real
 * extra headroom — but only if traffic actually reaches it. Failover already
 * walks every key on an error; it just always starts at the first, so key 1
 * absorbs everything until it 429s and the spares sit idle behind it. Rotating
 * the *starting point* spreads the load evenly.
 *
 * This deliberately never changes which provider serves a turn. An earlier
 * version also rotated between different providers that advertised the same
 * model id, which sounds equivalent and is not: the same id on two providers
 * can differ in quantisation, context limit, tokeniser, safety filtering and
 * price, so "the same model" is a claim about the label, not the weights. If
 * you picked a provider, your turn goes to that provider.
 *
 * It is not a fallback mechanism: it does not retry, does not substitute a
 * different model, and never overrides an explicit choice. Failover is the
 * separate feature that owns what happens *after* an error.
 */

import type { Provider } from "./types";

/** Cursor state, one counter per provider. Callers own it so this stays pure. */
export type Cursors = Record<string, number>;

/**
 * Process-wide cursors for callers that have nowhere to put them.
 *
 * Deliberately not persisted: which key served the last turn is worth nothing
 * after a restart, and writing it to settings on every request would mean a
 * disk write per message.
 */
let live: Cursors = {};

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
 * How many real keys a provider carries.
 *
 * Distinct from `keysOf(p).length`, which reports 1 for a keyless provider
 * because callers there need exactly one attempt. This one answers "is there
 * anything to rotate", where a local server's zero keys must read as zero.
 */
export function keyCount(p: { apiKey: string; apiKeys?: string[] }): number {
  return [p.apiKey, ...(p.apiKeys ?? [])].filter((k) => (k ?? "").trim().length > 0).length;
}

/**
 * Rotate a provider's keys so a different one leads each request.
 *
 * The rest of the list stays intact behind the leader, so a failed attempt
 * still falls through to every other key exactly as it did before.
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
