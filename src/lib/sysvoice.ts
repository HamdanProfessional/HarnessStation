/**
 * Picking a system voice that can actually speak the text.
 *
 * Windows has two separate voice registries. System.Speech (SAPI) only sees the
 * handful shipped with the OS — almost always English-only. Everything you install
 * through Settings → Time & language → Speech (Urdu, Arabic, Hindi, …) lands in the
 * OneCore registry, which SAPI cannot load. Ask an English SAPI voice to read Urdu
 * and it produces silence, which is exactly the "it replied in text but not speech"
 * failure. So we enumerate both and route each utterance to a voice whose language
 * matches the script it's written in.
 */
import { invoke } from "@tauri-apps/api/core";
import { isLinux } from "./platform";

export interface SysVoice {
  name: string;
  /** BCP-47-ish tag, e.g. "ur-PK". Lower-cased. */
  lang: string;
  /** "sapi" plays through the persistent speech host; "winrt" synthesizes to a WAV. */
  engine: "sapi" | "winrt";
}

let cached: SysVoice[] | null = null;

function parse(lines: string[], engine: SysVoice["engine"]): SysVoice[] {
  return lines
    .map((l) => l.split("\t"))
    .filter((p) => p[0]?.trim())
    .map((p) => ({ name: p[0].trim(), lang: (p[1] ?? "").trim().toLowerCase(), engine }));
}

/** Every voice installed on this machine, from both Windows voice registries. */
export async function listSystemVoices(refresh = false): Promise<SysVoice[]> {
  if (cached && !refresh) return cached;
  const [sapi, winrt] = await Promise.all([
    invoke<string[]>("speak_voices").catch(() => [] as string[]),
    invoke<string[]>("winrt_voices").catch(() => [] as string[]),
  ]);
  const all = [...parse(sapi, "sapi"), ...parse(winrt, "winrt")];
  // A voice present in both registries is the same voice — prefer the SAPI entry,
  // which streams through the persistent host and starts faster.
  const seen = new Set<string>();
  cached = all.filter((v) => {
    const key = v.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return cached;
}

/** Languages we have at least one installed voice for. */
export async function installedVoiceLanguages(): Promise<Set<string>> {
  const voices = await listSystemVoices();
  return new Set(voices.map((v) => v.lang.split("-")[0]).filter(Boolean));
}

/**
 * Guess the language of a string from the script it's written in. Only needs to be
 * right about "can the current voice read this", so script-level accuracy is enough.
 */
export function detectLang(text: string, fallback = "en"): string {
  const t = text.replace(/\s+/g, "");
  if (!t) return fallback;
  const has = (re: RegExp) => re.test(t);
  if (has(/[가-힯ᄀ-ᇿ]/)) return "ko";
  if (has(/[぀-ゟ゠-ヿ]/)) return "ja";
  if (has(/[一-鿿]/)) return "zh";
  if (has(/[฀-๿]/)) return "th";
  if (has(/[ऀ-ॿ]/)) return "hi";
  if (has(/[ঀ-৿]/)) return "bn";
  if (has(/[஀-௿]/)) return "ta";
  if (has(/[֐-׿]/)) return "he";
  if (has(/[Ͱ-Ͽ]/)) return "el";
  if (has(/[Ѐ-ӿ]/)) return "ru";
  if (has(/[؀-ۿݐ-ݿﭐ-﷿]/)) {
    // Arabic script covers Arabic, Persian and Urdu — these letters separate them.
    if (has(/[ےٹڈڑںھہیۓ]/)) return "ur";
    if (has(/[پچژگی]/)) return "fa";
    return "ar";
  }
  return fallback;
}

/** Best installed voice for a language, or null if nothing can speak it. */
export async function voiceForLang(lang: string, preferred?: string): Promise<SysVoice | null> {
  const voices = await listSystemVoices();
  const base = lang.split("-")[0].toLowerCase();
  // An explicitly chosen voice wins, but only if it speaks the right language.
  if (preferred) {
    const hit = voices.find((v) => v.name === preferred);
    if (hit && (!hit.lang || hit.lang.startsWith(base))) return hit;
  }
  return (
    voices.find((v) => v.lang === lang.toLowerCase()) ??
    voices.find((v) => v.lang.startsWith(`${base}-`)) ??
    voices.find((v) => v.lang === base) ??
    null
  );
}

/** Speak through the WinRT synthesizer (the only way to reach Settings-installed voices). */
export async function winrtSpeakToDataUrl(text: string, voice: string): Promise<string> {
  const out = "tmp/winrt-out.wav";
  await invoke<string>("winrt_speak", { text, voice, outWav: out });
  const { readFile, BaseDirectory } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(`.harnessx/${out}`, { baseDir: BaseDirectory.Home });
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** Actionable message when nothing installed can speak this language. */
export function missingVoiceHelp(lang: string, langName: string): string {
  const name = langName || lang;
  if (isLinux()) {
    return (
      `No installed voice can speak ${name}. espeak-ng covers most languages — ` +
      `install it with \`sudo apt install espeak-ng\` (or your distro's equivalent). ` +
      `Or set a cloud/local TTS model under Media models, which handles any language.`
    );
  }
  return (
    `No installed Windows voice can speak ${name}. ` +
    `Open Settings → Time & language → Language & region, add ${name}, ` +
    `click its "…" → Language options, and install the Speech (text-to-speech) pack. ` +
    `Or set a cloud/local TTS model under Media models, which handles any language.`
  );
}
