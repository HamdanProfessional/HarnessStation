/**
 * What My Models says about a provider, and how sure it is.
 *
 * This used to be built inline as one dim sentence per card:
 *
 *   API key set · answered with 47 models · <error>
 *
 * Three unrelated facts — how it authenticates, whether it answered, and what
 * went wrong — rendered at identical weight and joined by middots, so nothing
 * could be found by scanning. They are separate badges now, and the rules for
 * which badge to show live here where they can be tested.
 */

/** Reuses the app's existing `.pill` tones; "neutral" is the bare pill. */
export type BadgeTone = "ok" | "warn" | "danger" | "neutral";

export interface Badge {
  label: string;
  tone: BadgeTone;
  /** Longer explanation for the title attribute, when the label has to be short. */
  title?: string;
}

export interface ProbeState {
  state: "checking" | "ok" | "error";
  count?: number;
  error?: string;
  at?: number;
}

export interface ProviderFacts {
  /** A local server (Ollama, LM Studio, llama.cpp) — these need no key. */
  localish: boolean;
  hasKey: boolean;
  probe?: ProbeState;
}

/**
 * The connection dot's state.
 *
 * Unchecked is deliberately its own state rather than being folded into
 * "error": not-yet-asked is a different claim from failed, and showing red for
 * it would tell every user their working setup is broken before the page has
 * even probed anything.
 */
export function dotState(probe?: ProbeState): "on" | "bad" | "checking" | "unknown" {
  if (!probe) return "unknown";
  if (probe.state === "ok") return "on";
  if (probe.state === "error") return "bad";
  return "checking";
}

/** How a provider authenticates. Always present — it is never "unknown". */
export function authBadge({ localish, hasKey }: ProviderFacts): Badge {
  if (localish) return { label: "Local", tone: "neutral", title: "A local server — no API key needed" };
  if (hasKey) return { label: "Key set", tone: "ok", title: "An API key is stored in the OS keychain" };
  return { label: "No key", tone: "warn", title: "Add an API key before this provider can be used" };
}

/**
 * What happened the last time we asked the provider for its model list.
 *
 * Returns null when it has never been checked. A "Not checked" badge would be
 * noise on a page where most providers start that way, and the grey dot already
 * carries it.
 */
export function probeBadge(probe?: ProbeState): Badge | null {
  if (!probe) return null;
  if (probe.state === "checking") return { label: "Checking…", tone: "neutral" };
  if (probe.state === "ok") {
    const n = probe.count ?? 0;
    return {
      label: `Answered · ${n} model${n === 1 ? "" : "s"}`,
      tone: "ok",
      title: "The provider responded with this many models",
    };
  }
  // An error string from a provider can be a whole HTTP body. The pill is one
  // line on a card, so it is truncated here and given the full text on hover
  // rather than being allowed to break the layout.
  const raw = (probe.error ?? "Failed").trim() || "Failed";
  return { label: truncate(raw, 60), tone: "danger", title: raw };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Every badge for one provider, in reading order. */
export function providerBadges(facts: ProviderFacts): Badge[] {
  const out = [authBadge(facts)];
  const probe = probeBadge(facts.probe);
  if (probe) out.push(probe);
  return out;
}

export interface ProviderLike {
  id: string;
  apiKey: string;
  models: string[];
}

export interface PageStats {
  /** Providers that answered a probe. */
  connected: number;
  /** Providers listed on the page. */
  total: number;
  /** Distinct model ids across every provider. */
  models: number;
  /** Providers added but still missing a key. */
  needKey: number;
}

/**
 * The numbers for the summary strip.
 *
 * Models are counted distinctly because the same id legitimately appears under
 * several providers — that is exactly the case round-robin exists for — and
 * summing them would claim a catalogue several times larger than it is.
 */
export function pageStats(providers: ProviderLike[], probes: Record<string, ProbeState>): PageStats {
  const ids = new Set<string>();
  let connected = 0;
  let needKey = 0;
  for (const p of providers) {
    for (const m of p.models) ids.add(m);
    if (probes[p.id]?.state === "ok") connected++;
    if (!p.apiKey.trim()) needKey++;
  }
  return { connected, total: providers.length, models: ids.size, needKey };
}
