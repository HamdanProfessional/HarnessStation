import { invoke } from "@tauri-apps/api/core";
import { generateMedia, mediaConfigFromSettings } from "./media";
import { humanSsml, spokenForm } from "./humanize";
import { rewriteForSpeech, speechModel } from "./speechRewrite";
import { sttLanguageName } from "./whisper";
import {
  detectLang,
  missingVoiceHelp,
  voiceForLang,
  winrtSpeakToDataUrl,
} from "./sysvoice";
import { toast } from "./toast";

/** Only warn once per language, not once per sentence. */
let lastMissingLang: string | null = null;

/** The language the user configured, if they pinned one. */
function preferredLang(settings: Settings): string {
  const reply = settings.voice?.replyLanguage;
  if (reply && reply !== "match") return reply;
  const spoken = settings.voice?.language;
  return spoken && spoken !== "auto" ? spoken : "";
}
import type { Settings } from "./types";

/**
 * Speech output for the talking avatar.
 *
 * Uses the built-in Windows voice (offline, zero setup) by default, and automatically
 * upgrades to the configured media TTS model (OpenAI-compatible / local) when one exists.
 * Utterances are queued so streamed sentences play back in order without overlapping.
 */

/**
 * Queued utterances. Each entry is a promise so an optional small-model rewrite
 * (see speechRewrite.ts) can run *while the previous sentence is still playing* —
 * by the time we get to it, it's usually already resolved.
 */
let queue: Promise<string>[] = [];
let draining = false;
let cancelled = false;
let currentAudio: HTMLAudioElement | null = null;

/**
 * Everyone waiting for the queue to drain. A single callback slot used to be
 * enough until two callers overlapped — the second overwrote the first, and the
 * first promise never settled, hanging whatever awaited it.
 */
let waiters: (() => void)[] = [];

function releaseWaiters(): void {
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

function pickTtsModel(settings: Settings) {
  const cfg = mediaConfigFromSettings(settings);
  const id = cfg.defaults.audio;
  return (
    cfg.models.find((m) => m.id === id && m.kind === "audio") ??
    cfg.models.find((m) => m.kind === "audio")
  );
}

/** True when a media TTS model will be used instead of the Windows voice. */
export function usingMediaVoice(settings: Settings): boolean {
  return !!pickTtsModel(settings);
}

function playDataUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    const finish = () => {
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onended = finish;
    audio.onerror = finish;
    void audio.play().catch(finish);
  });
}

/**
 * Whether the neural voice is already downloaded. Cached because "auto" consults
 * it before every utterance and the answer only changes on a fresh install.
 */
let piperInstalled: { voice: string; ready: boolean } | null = null;

async function neuralReady(voiceId: string): Promise<boolean> {
  if (piperInstalled?.voice === voiceId) return piperInstalled.ready;
  try {
    const { piperReady } = await import("./piper");
    const ready = await piperReady(voiceId);
    piperInstalled = { voice: voiceId, ready };
    return ready;
  } catch {
    return false;
  }
}

/** Call after installing a voice so "auto" starts using it without a restart. */
export function invalidateNeuralVoice(): void {
  piperInstalled = null;
}

/** Speak through Piper. Returns false if it couldn't, so the caller can fall back. */
async function speakWithPiper(text: string, voiceId: string, human: boolean): Promise<boolean> {
  try {
    const { ensurePiper, piperSynthesize } = await import("./piper");
    await ensurePiper(() => {}, voiceId);
    piperInstalled = { voice: voiceId, ready: true };
    const url = await piperSynthesize(text, voiceId, human);
    if (cancelled) return true;
    await playDataUrl(url);
    return true;
  } catch {
    return false; // caller falls back so speech never goes silent
  }
}

async function speakOnce(raw: string, settings: Settings): Promise<void> {
  const engine = settings.voice?.ttsEngine ?? "auto";
  const human = settings.voice?.humanDelivery ?? true;
  const text = human ? spokenForm(raw) : raw;
  // Left blank when unset — the piper module resolves that to its default voice,
  // so the engine is only loaded on the paths that actually use it.
  const piperVoiceId = settings.voice?.piperVoice || "";
  // Piper's bundled voices are English-only; anything else needs a system voice.
  const english = detectLang(text, preferredLang(settings) || "en") === "en";

  // Offline neural voice, chosen explicitly — download it if this is the first use.
  if (engine === "piper" && english) {
    if (await speakWithPiper(text, piperVoiceId, human)) return;
  }

  const model = engine === "windows" ? undefined : pickTtsModel(settings);
  if (model) {
    try {
      const { dataUrl } = await generateMedia(model, text);
      if (cancelled) return;
      await playDataUrl(dataUrl);
      return;
    } catch {
      // fall through to the built-in voice if the cloud/local TTS fails
    }
  }

  // "Auto" should mean the best voice available, and the SAPI voices are markedly
  // flatter than Piper. Use the neural voice when it's already installed — never
  // trigger an ~80 MB download from a setting the user didn't explicitly pick.
  if (engine === "auto" && english && (await neuralReady(piperVoiceId))) {
    if (await speakWithPiper(text, piperVoiceId, human)) return;
  }
  // Route to a voice that can actually read this script. An English SAPI voice
  // handed Urdu or Arabic just produces silence, so we detect the language and
  // pick a matching voice — including the Settings-installed OneCore ones, which
  // are only reachable through the WinRT synthesizer.
  const lang = detectLang(text, preferredLang(settings) || "en");
  const voice = await voiceForLang(lang, settings.voice?.winVoice || undefined);

  if (!voice) {
    const help = missingVoiceHelp(lang, sttLanguageName(lang));
    if (lastMissingLang !== lang) {
      lastMissingLang = lang;
      toast.error(help);
    }
    throw new Error(help);
  }
  lastMissingLang = null;

  if (voice.engine === "winrt") {
    const url = await winrtSpeakToDataUrl(text, voice.name);
    if (cancelled) return;
    await playDataUrl(url);
    return;
  }

  // SAPI voices are the flattest of the lot, so they get the most help:
  // SSML breath pauses plus a little pitch/rate movement per sentence.
  await invoke("speak", {
    text: human
      ? humanSsml(text, {
          expressiveness: settings.voice?.expressiveness ?? 1,
          lang: voice.lang || lang,
        })
      : text,
    voice: voice.name,
    rate: settings.voice?.rate ?? 1,
  });
}

async function drain(settings: Settings) {
  if (draining) return;
  draining = true;
  try {
    while (queue.length && !cancelled) {
      const next = await queue.shift()!;
      if (cancelled) break;
      await speakOnce(next, settings);
    }
  } finally {
    draining = false;
    // Also release when the queue was abandoned mid-drain (cancelled), or a
    // barge-in would leave the caller awaiting a queue nobody will finish.
    if (!queue.length || cancelled) releaseWaiters();
  }
}

/** Speak one utterance immediately and await it (used for voice previews). */
export async function speakNow(text: string, settings: Settings): Promise<void> {
  cancelled = false;
  await speakOnce(text, settings);
}

/** Queue a sentence/utterance for speaking. Returns immediately. */
export function speakQueued(text: string, settings: Settings): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  cancelled = false;
  const choice = speechModel(settings);
  // Kick the rewrite off now, not when its turn comes — it overlaps with playback.
  queue.push(choice ? rewriteForSpeech(clean, choice, languageHint(settings)) : Promise.resolve(clean));
  void drain(settings);
}

/** Keep the rewriter in the same language as the reply. */
function languageHint(settings: Settings): string {
  const code = settings.voice?.replyLanguage;
  const named = code && code !== "match" ? sttLanguageName(code) : sttLanguageName(settings.voice?.language ?? "");
  return named ? `The text is in ${named}. Write your rewrite in ${named}.` : "";
}

/** Resolves once the queue has fully drained (or was stopped). */
export function whenSpoken(): Promise<void> {
  if (!draining && !queue.length) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

/** Stop speaking immediately and drop anything queued (barge-in). */
export async function stopSpeaking(): Promise<void> {
  cancelled = true;
  queue = [];
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  try {
    await invoke("speak_stop");
  } catch {
    /* nothing speaking */
  }
  releaseWaiters();
}

/** Installed Windows voice names (for the picker in Settings). */
export async function listWindowsVoices(): Promise<string[]> {
  try {
    return await invoke<string[]>("speak_voices");
  } catch {
    return [];
  }
}

/** Strip markdown/emoji noise so the voice reads naturally. */
export function speakableText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
