/**
 * System text-to-speech for the web build.
 *
 * The desktop app speaks through SAPI/WinRT (Windows) or espeak (Linux). The
 * browser's own equivalent is the Web Speech API — SpeechSynthesis — with the
 * voices the operating system already has installed. So the app's "Windows /
 * system" voice engine maps straight onto it, and the neural engines it prefers
 * (Kokoro in-WASM, or a cloud service) are unaffected since those never reach
 * here.
 *
 * Registered into the invoke() dispatcher so `invoke("speak")` resolves here.
 */

import { registerCommand } from "./core";

/** Web Speech has no SSML; strip the tags the app's humaniser adds. */
function plain(text: string): string {
  return text
    .replace(/<break[^>]*\/?>/gi, ", ") // a pause becomes a comma's worth of breath
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * getVoices() is empty until the engine has loaded them, which happens
 * asynchronously on first use. Wait once for the voiceschanged event.
 */
function voices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    // Some engines never fire the event; don't hang the voice picker on them.
    setTimeout(() => resolve(synth.getVoices()), 1000);
  });
}

/** SAPI rate is roughly -10..10; Web Speech is a 0.1..10 multiplier around 1. */
function webRate(rate: unknown): number {
  const r = typeof rate === "number" ? rate : 1;
  const mapped = Math.abs(r) > 3 ? 1 + r / 10 : r;
  return Math.min(10, Math.max(0.1, mapped || 1));
}

registerCommand("speak", async (args) => {
  const { text, voice, rate } = (args ?? {}) as { text: string; voice?: string; rate?: number };
  const synth = window.speechSynthesis;
  const utter = new SpeechSynthesisUtterance(plain(String(text ?? "")));
  utter.rate = webRate(rate);

  if (voice) {
    const match = (await voices()).find((v) => v.name === voice);
    if (match) utter.voice = match;
  }

  // Resolve when the utterance finishes, so the app's speech queue plays lines
  // in order rather than starting them all at once.
  await new Promise<void>((resolve) => {
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    synth.speak(utter);
  });
  return null;
});

registerCommand("speak_stop", () => {
  window.speechSynthesis.cancel();
  return null;
});

registerCommand("speak_voices", async () => (await voices()).map((v) => v.name));
