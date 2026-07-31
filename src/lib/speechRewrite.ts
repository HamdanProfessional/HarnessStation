/**
 * Optional last pass before an utterance is spoken: a small, fast model rewrites
 * the reply into the way a person would actually say it out loud.
 *
 * The regex humanizer in humanize.ts handles the mechanical stuff (contractions,
 * "e.g." → "for example"). This handles what regexes can't — dropping written-only
 * scaffolding, breaking a clause-heavy sentence into speakable chunks, turning a
 * path or a number into something you'd say. A 1–3 B local model is plenty.
 *
 * Everything here is best-effort: on timeout, error, or a suspicious result it
 * returns the original text, so the avatar never goes quiet because of it.
 */
import { streamChat } from "./providers";
import type { Provider, Settings } from "./types";

const SYSTEM = `You rewrite text so it sounds natural when spoken aloud by a voice assistant.
Rules:
- Keep the exact same meaning and every fact, name and number. Never add information, never answer anything.
- Use contractions and everyday spoken words. Break long clause-heavy sentences into short ones.
- Say numbers, symbols and paths the way a person says them ("about 40 percent", "your Desktop folder").
- Drop written-only scaffolding: markdown, bullets, "Note that", "In summary", "As mentioned".
- Keep it the same length or shorter. Never pad.
Reply with ONLY the rewritten text. No quotes, no preamble, no explanation.`;

/** Below this, rewriting costs more latency than it's worth. */
const MIN_CHARS = 40;
const TIMEOUT_MS = 1500;

const cache = new Map<string, string>();

export interface SpeechModelChoice {
  provider: Provider;
  model: string;
}

/** Resolve the small model configured for speech rewriting, if any. */
export function speechModel(settings: Settings): SpeechModelChoice | null {
  const v = settings.voice;
  if (!v?.speechRewrite) return null;
  const provider = settings.providers.find((p) => p.id === v.speechProviderId);
  const model = v.speechModel || provider?.models[0] || "";
  if (!provider || !model) return null;
  return { provider, model };
}

interface Attempt {
  /** True when the rewrite was accepted; false means we fall back to the original. */
  ok: boolean;
  text: string;
  /** Why it was rejected, for the test button. */
  note: string;
  ms: number;
}

/** One rewrite attempt with full detail. Never throws. */
async function attempt(
  text: string,
  choice: SpeechModelChoice,
  extra: string,
  timeoutMs: number,
): Promise<Attempt> {
  const started = performance.now();
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), timeoutMs);
  try {
    let out = "";
    await streamChat({
      provider: choice.provider,
      model: choice.model,
      system: extra ? `${SYSTEM}\n${extra}` : SYSTEM,
      messages: [{ role: "user", content: text }],
      temperature: 0.3,
      maxTokens: 200,
      noThinking: true, // reasoning here is pure latency
      signal: aborter.signal,
      onDelta: (d) => (out += d),
    });
    const ms = performance.now() - started;
    // Small models sometimes wrap the answer in quotes or a <think> block.
    const clean = out
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/^["'“”]|["'“”]$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return { ok: false, text, note: "model returned nothing", ms };
    if (clean.length > text.length * 1.6 + 40)
      return { ok: false, text, note: "rejected — model padded the text", ms };
    if (clean.length < text.length * 0.35)
      return { ok: false, text, note: "rejected — model dropped too much", ms };
    if (/^(sure|certainly|here'?s|okay,? here|rewritten)\b/i.test(clean))
      return { ok: false, text, note: "rejected — model chatted instead of rewriting", ms };
    return { ok: true, text: clean, note: "ok", ms };
  } catch (e) {
    const ms = performance.now() - started;
    const aborted = (e as Error).name === "AbortError";
    return {
      ok: false,
      text,
      note: aborted ? `timed out after ${Math.round(ms)}ms` : (e as Error).message || String(e),
      ms,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rewrite one utterance for speech. Returns the original text unchanged if the
 * model is slow, unavailable, or produces something that doesn't look like a
 * faithful rewrite.
 */
export async function rewriteForSpeech(
  text: string,
  choice: SpeechModelChoice,
  extra = "",
): Promise<string> {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CHARS) return text;
  const key = `${choice.model}:${extra}:${trimmed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const res = await attempt(trimmed, choice, extra, TIMEOUT_MS);
  if (!res.ok) return text;
  if (cache.size > 200) cache.clear();
  cache.set(key, res.text);
  return res.text;
}

/** A sample containing exactly what the rewriter is supposed to fix. */
export const TEST_SAMPLE =
  "I have updated the configuration file at C:\\Users\\you\\Desktop\\project\\config.json, " +
  "which had approximately 40% of its entries set incorrectly (e.g. the timeout values), " +
  "and it is now the case that the build will not fail on startup.";

export interface RewriteTestResult {
  ok: boolean;
  input: string;
  output: string;
  note: string;
  ms: number;
  /** True when the model's own reply was accepted (not the regex fallback). */
  usedModel: boolean;
}

/**
 * Run the rewriter once against a fixed sample and report exactly what happened —
 * including whether it was rejected and why. Bypasses the cache and the length
 * floor, and allows longer than the live timeout so a slow model still shows a
 * result you can judge (with its real latency printed).
 */
export async function testRewrite(
  choice: SpeechModelChoice,
  sample = TEST_SAMPLE,
): Promise<RewriteTestResult> {
  const res = await attempt(sample, choice, "", 20_000);
  const tooSlow = res.ok && res.ms > TIMEOUT_MS;
  return {
    ok: res.ok && !tooSlow,
    input: sample,
    output: res.text,
    usedModel: res.ok,
    ms: Math.round(res.ms),
    note: tooSlow
      ? `works, but took ${Math.round(res.ms)}ms — over the ${TIMEOUT_MS}ms live budget, so it would be skipped in real use. Try a smaller model.`
      : res.note,
  };
}
