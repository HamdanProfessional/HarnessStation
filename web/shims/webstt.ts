/*
 * Speech-to-text for the web build, using the browser's built-in
 * SpeechRecognition (Web Speech API) instead of a downloaded Whisper model.
 *
 * Why: the transformers.js Whisper path has to fetch tens of megabytes of model
 * weights + ONNX runtime into the tab, which is slow and fails outright on some
 * setups ("whisper can't install"). Chrome/Edge already ship a fast, free
 * recognizer — so on the web we use it. It pairs with the Web Speech *synthesis*
 * we already use for the voice's replies.
 *
 * The app's voice loop is file-based: it records a segment, then asks Whisper to
 * transcribe that WAV. We keep that contract intact by running recognition
 * continuously alongside the recorder and buffering the text. When the recorder
 * hands back a segment, the mic shim stashes the recognized text under a token
 * embedded in the returned path; the whisper shim reads that token instead of
 * decoding audio. So voice.ts and audio.ts are untouched.
 *
 * SpeechRecognition lifecycle == recorder lifecycle:
 *   mic_start  -> sttStart (fresh buffer)
 *   mic_snapshot (live pass) -> sttPeek  (non-consuming)
 *   mic_take   (utterance done, keep recording) -> sttTake (consume, keep going)
 *   mic_stop   (discard / end)  -> sttStop
 */

type Recog = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
};

function SR(): (new () => Recog) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function sttSupported(): boolean {
  return !!SR();
}

let recog: Recog | null = null;
let active = false;
let finalText = "";
let interim = "";
let lang = "";
let lastError = "";

/** App language codes are ISO-639 ("en", "es"); SpeechRecognition wants BCP-47. */
const LANG_MAP: Record<string, string> = {
  en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR",
  nl: "nl-NL", ru: "ru-RU", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", hi: "hi-IN",
  ar: "ar-SA", tr: "tr-TR", pl: "pl-PL", uk: "uk-UA", sv: "sv-SE",
};
function toBcp47(code?: string): string {
  if (!code || code === "auto") return "";
  if (code.includes("-")) return code;
  return LANG_MAP[code] || code;
}

/** Set the recognition language (call before/around sttStart). */
export function sttSetLang(code?: string): void {
  const next = toBcp47(code);
  if (next === lang) return;
  lang = next;
  if (recog) recog.lang = lang || navigator.language || "en-US";
}

export function sttStart(code?: string): boolean {
  const Ctor = SR();
  if (!Ctor) return false;
  if (code !== undefined) sttSetLang(code);
  stopRecog();
  finalText = "";
  interim = "";
  active = true;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = lang || navigator.language || "en-US";
  r.onresult = (e: any) => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
  };
  // Chrome ends recognition on its own after a pause or a timeout; while we're
  // meant to be listening, restart it so the buffer keeps filling.
  r.onend = () => {
    if (active) {
      try { r.start(); } catch { /* already starting */ }
    }
  };
  r.onerror = (e: any) => {
    // no-speech / aborted are normal; keep only the ones worth surfacing.
    if (e?.error && e.error !== "no-speech" && e.error !== "aborted") lastError = String(e.error);
  };
  recog = r;
  try {
    r.start();
  } catch {
    /* a stray double-start; the instance is still live */
  }
  return true;
}

function current(): string {
  return `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
}

/** Read the text so far WITHOUT consuming it (rolling live transcript). */
export function sttPeek(): string {
  return current();
}

/** Read the text so far and clear the buffer; recognition keeps running. */
export function sttTake(): string {
  const t = current();
  finalText = "";
  interim = "";
  return t;
}

/** Read the final text and stop recognition. */
export function sttStop(): string {
  const t = current();
  active = false;
  stopRecog();
  return t;
}

function stopRecog(): void {
  if (!recog) return;
  const r = recog;
  recog = null;
  try {
    r.onend = null;
    r.onresult = null;
    r.stop();
  } catch {
    try { r.abort(); } catch { /* gone */ }
  }
}

export function sttLastError(): string {
  return lastError;
}

// --- token stash: bridges the mic shim (which has the text) and the whisper
// shim (which is handed only a path). Small ring so it can't grow unbounded.
const stash = new Map<string, string>();
let seq = 0;

export function stashTranscript(kind: string, text: string): string {
  const id = `${kind}${++seq}`;
  stash.set(id, text);
  if (stash.size > 64) stash.delete(stash.keys().next().value as string);
  return id;
}

/** Pull (and forget) the text a path token points at. */
export function takeTranscript(token: string): string | null {
  if (!stash.has(token)) return null;
  const t = stash.get(token) ?? "";
  stash.delete(token);
  return t;
}
