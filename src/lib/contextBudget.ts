/**
 * How much of the model's context memory is allowed to occupy.
 *
 * Recalled memory is only useful if the model can still fit the actual
 * conversation. A 50k-token memory store injected into an 8k local model doesn't
 * degrade the answer, it makes the request fail outright — so memory is capped
 * as a *share* of the window rather than a fixed number of facts.
 *
 * Sizes are inferred from the model name, because almost no OpenAI-compatible
 * endpoint reports its context length and users rarely know it. The guess errs
 * small: under-estimating trims a few facts, over-estimating breaks the turn.
 */

/** Fallback when the name tells us nothing — the smallest thing still common. */
const DEFAULT_CONTEXT = 8_192;

/** Share of the window memory may use. The user's ceiling was "25%, not more". */
export const DEFAULT_MEMORY_SHARE = 0.2;
export const MAX_MEMORY_SHARE = 0.25;

/** Rough chars-per-token. Deliberately low so the estimate over-counts slightly. */
const CHARS_PER_TOKEN = 3.6;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Matched in order, first hit wins — so put the specific patterns first.
 * These are the families this app actually points at.
 */
const CONTEXT_HINTS: [RegExp, number][] = [
  // Explicit in the name: "…-128k", "…:32k", "…-1m"
  [/[-_:/](\d{1,4})m\b/i, -1_000_000],
  [/[-_:/](\d{1,4})k\b/i, -1_000],

  [/gpt-5|gpt-4\.1|o[34]-|o1-/i, 200_000],
  [/gpt-4o|gpt-4-turbo/i, 128_000],
  [/gpt-4\b/i, 8_192],
  [/gpt-3\.5/i, 16_385],
  [/claude/i, 200_000],
  [/gemini.*(1\.5|2|3)/i, 1_000_000],
  [/gemini/i, 32_768],
  [/deepseek/i, 64_000],
  [/qwen ?3|qwen2\.5/i, 32_768],
  [/qwen/i, 32_768],
  [/llama-?3\.[123]|llama-?4/i, 128_000],
  [/llama-?3/i, 8_192],
  [/llama-?2/i, 4_096],
  [/mistral|mixtral|ministral/i, 32_768],
  [/phi-?[34]/i, 128_000],
  [/gemma-?[23]/i, 8_192],
  [/command-?r/i, 128_000],
  [/grok/i, 131_072],
  [/kimi|moonshot/i, 128_000],
  [/glm-?[45]/i, 128_000],
  [/minimax/i, 1_000_000],
  [/nemotron|yi-|solar/i, 32_768],
];

/**
 * Best guess at a model's context window, in tokens.
 * A number embedded in the name ("-128k") wins over the family default, since
 * that's usually the quantised/served variant the user actually loaded.
 */
export function contextWindowFor(model: string): number {
  const name = (model ?? "").trim();
  if (!name) return DEFAULT_CONTEXT;
  for (const [re, size] of CONTEXT_HINTS) {
    const m = re.exec(name);
    if (!m) continue;
    if (size < 0) {
      // Negative marks a "capture group × unit" rule.
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n * -size;
      continue;
    }
    return size;
  }
  return DEFAULT_CONTEXT;
}

/** Token ceiling for injected memory on this model. */
export function memoryBudget(model: string, share = DEFAULT_MEMORY_SHARE): number {
  const clamped = Math.min(Math.max(share, 0), MAX_MEMORY_SHARE);
  return Math.floor(contextWindowFor(model) * clamped);
}

export interface TrimResult {
  /** The facts that fit, in the order given. */
  kept: string[];
  /** How many were dropped for space. */
  dropped: number;
  /** Estimated tokens the kept facts occupy. */
  tokens: number;
}

/**
 * Keep as many facts as the budget allows, most relevant first.
 *
 * Recall already returns them ranked, so this trims the tail rather than trying
 * to be clever — a fact that didn't make the cut was the least relevant one.
 * A single fact longer than the whole budget is truncated rather than dropped,
 * so an over-long note can't silently erase itself.
 */
export function trimToBudget(facts: string[], budgetTokens: number): TrimResult {
  if (budgetTokens <= 0) return { kept: [], dropped: facts.length, tokens: 0 };

  const kept: string[] = [];
  let used = 0;
  for (let i = 0; i < facts.length; i++) {
    const cost = estimateTokens(facts[i]) + 2; // + the "- " bullet and newline
    if (used + cost <= budgetTokens) {
      kept.push(facts[i]);
      used += cost;
      continue;
    }
    if (!kept.length) {
      // Nothing fits at all: keep a truncated head of the best fact.
      const chars = Math.max(0, Math.floor((budgetTokens - 2) * CHARS_PER_TOKEN));
      if (chars > 20) {
        kept.push(`${facts[i].slice(0, chars - 1)}…`);
        used = budgetTokens;
      }
    }
    return { kept, dropped: facts.length - kept.length, tokens: used };
  }
  return { kept, dropped: 0, tokens: used };
}
