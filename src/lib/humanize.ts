/**
 * Makes synthesized speech sound like a person rather than a screen reader.
 *
 * Two jobs:
 *  1. `spokenForm` rewrites things nobody says out loud — "e.g.", "~/docs", "50%",
 *     "AI" — into what a person would actually say.
 *  2. `humanSsml` wraps the result in SSML with real breath pauses and a little
 *     pitch/rate movement per sentence, so the delivery isn't flat and metronomic.
 *
 * The variation is derived from a hash of the sentence, not a random number, so the
 * same line always sounds the same — drift between replays sounds broken, not human.
 */

const ABBREV: [RegExp, string][] = [
  // Links and paths first: the "/" -> " or " rule below would otherwise shred a
  // URL into "https: or or example.com" before it could be collapsed.
  [/\bhttps?:\/\/\S+/gi, "the link"],
  [/[A-Za-z]:\\[^\s]+/g, "that folder"], // C:\Users\...
  [/~?[/\\][\w.-]+[/\\]\S*/g, "that path"],
  [/\be\.g\.\s*/gi, "for example, "],
  [/\bi\.e\.\s*/gi, "that is, "],
  [/\betc\.?/gi, "and so on"],
  // The trailing \b never matched across ".", so the period survived and the
  // sentence splitter broke mid-clause ("A versus. B"). Anchor on the gap instead.
  [/\bvs\.?(?=\s|$)/gi, "versus"],
  [/\bapprox\.?(?=\s|$)/gi, "roughly"],
  [/\bw\/\b/gi, "with"],
  [/\s*&\s*/g, " and "],
  [/\s*\/\s*/g, " or "],
  [/\+/g, " plus "],
  [/(\d)\s*%/g, "$1 percent"],
  [/\$(\d+)/g, "$1 dollars"],
];

/** Contractions — written English uses the long form far more than speech does. */
const CONTRACT: [RegExp, string][] = [
  [/\bit is\b/gi, "it's"],
  [/\bthat is\b/gi, "that's"],
  [/\bthere is\b/gi, "there's"],
  [/\byou are\b/gi, "you're"],
  [/\bwe are\b/gi, "we're"],
  [/\bI am\b/g, "I'm"],
  [/\bI will\b/g, "I'll"],
  [/\bI have\b/g, "I've"],
  [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bdid not\b/gi, "didn't"],
  [/\bcannot\b/gi, "can't"],
  [/\bcan not\b/gi, "can't"],
  [/\bwill not\b/gi, "won't"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bwould not\b/gi, "wouldn't"],
  [/\bcould not\b/gi, "couldn't"],
  [/\blet us\b/gi, "let's"],
];

/** Rewrite text into what a person would actually say out loud. */
export function spokenForm(text: string, contractions = true): string {
  let out = text;
  for (const [re, to] of ABBREV) out = out.replace(re, to);
  if (contractions) for (const [re, to] of CONTRACT) out = out.replace(re, to);
  return out
    .replace(/\.{3,}/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Stable small integer from a string, so the same sentence always gets the same shaping. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface HumanizeOptions {
  /** 0 = flat/robotic, 1 = default movement, 2 = theatrical. */
  expressiveness?: number;
  /** Extra pause length multiplier. */
  pace?: number;
  /** BCP-47 tag for the SSML root — must match the voice or Windows ignores it. */
  lang?: string;
}

/**
 * Build SSML with breath pauses and per-sentence prosody. Falls back cleanly:
 * the speech host strips tags and speaks plain text if SSML isn't supported.
 */
export function humanSsml(text: string, opts: HumanizeOptions = {}): string {
  const amp = opts.expressiveness ?? 1;
  const pace = opts.pace ?? 1;
  const sentences = splitSentences(text);
  if (!sentences.length) return "";

  const br = (ms: number) => `<break time="${Math.round(ms * pace)}ms"/>`;

  const body = sentences
    .map((raw, i) => {
      const h = hash(raw);
      const question = /[?]\s*$/.test(raw);
      const exclaim = /!\s*$/.test(raw);
      // Openers land a touch slower; long sentences a touch faster; questions lift.
      const long = raw.length > 110;
      const rate = Math.round((i === 0 ? -4 : long ? 3 : 0) + ((h % 5) - 2)) * amp;
      const pitch = Math.round((question ? 6 : exclaim ? 4 : 0) + ((h % 3) - 1)) * amp;

      // Pause where a person breathes: after commas, dashes and clause colons.
      // Marked on the raw text and escaped afterwards — escaping first would let
      // the ";" that ends "&lt;" look like a clause break and pause mid-entity.
      const mark = (ms: number) => `${Math.round(ms * pace)}`;
      const inner = escapeXml(
        raw
          .replace(/,\s*/g, `,${mark(160)} `)
          .replace(/\s+[–—-]\s+/g, `${mark(220)} `)
          .replace(/[;:]\s*/g, (m) => `${m.trim()}${mark(240)} `)
          .replace(/…/g, `…${mark(300)}`),
      ).replace(/(\d+)/g, '<break time="$1ms"/>');

      const tail = i < sentences.length - 1 ? br(question ? 380 : 300) : "";
      return `<prosody rate="${rate >= 0 ? "+" : ""}${rate}%" pitch="${pitch >= 0 ? "+" : ""}${pitch}%">${inner}</prosody>${tail}`;
    })
    .join(" ");

  const lang = opts.lang?.trim() || "en-US";
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">${body}</speak>`;
}

/** Short, varied "I'm on it" noises so tool waits don't always use the same line. */
const FILLERS = [
  "One moment.",
  "Give me a sec.",
  "Let me check.",
  "On it.",
  "Alright, checking.",
  "Hang on.",
  "Sure — one sec.",
];

let lastFiller = -1;

/** Pick a filler that isn't the one used last time. */
export function pickFiller(): string {
  let i = Math.floor(Math.random() * FILLERS.length);
  if (i === lastFiller) i = (i + 1) % FILLERS.length;
  lastFiller = i;
  return FILLERS[i];
}
