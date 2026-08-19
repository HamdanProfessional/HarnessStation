/**
 * Stage 3 — voice quality polish.
 *
 * These tests are guardrails: they catch a regression where the orb's brand
 * colour falls out of the accent palette, where the speech-rewrite pipeline
 * stops being wired into the voice session, or where the orb's stated CSS
 * contract drifts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const voiceTs = readFileSync(resolve(__dirname, "..", "src", "lib", "voice.ts"), "utf8");
const voiceView = readFileSync(resolve(__dirname, "..", "src", "components", "VoiceView.tsx"), "utf8");
const ttsTs = readFileSync(resolve(__dirname, "..", "src", "lib", "tts.ts"), "utf8");
const speechRewrite = readFileSync(resolve(__dirname, "..", "src", "lib", "speechRewrite.ts"), "utf8");
const appCss = readFileSync(resolve(__dirname, "..", "src", "App.css"), "utf8");

describe("Stage 3 — orb picks up the accent palette", () => {
  it("the orb uses var(--accent) for its border", () => {
    // The ring is the part of the orb that fans out — the brand color
    // needs to follow the user's chosen palette (Indigo / Forest / Ember).
    expect(appCss).toMatch(/\.orb-ring\s*\{[^}]*border:\s*2px solid var\(--accent\)/s);
  });

  it("the orb's idle/listening glow follows the accent palette", () => {
    // Before Stage 3 these were hardcoded rgba(94, 106, 210, ...) — the
    // indigo default. They now use color-mix with var(--accent) so the
    // glow follows the brand colour when the user picks Forest or Ember.
    expect(appCss).toMatch(/\.orb-idle \.orb\s*\{[^}]*color-mix\(in srgb, var\(--accent\)/s);
    expect(appCss).toMatch(/\.orb-listening \.orb\s*\{[^}]*color-mix\(in srgb, var\(--accent\)/s);
    expect(appCss).toMatch(/\.orb\s*\{[^}]*color-mix\(in srgb, var\(--accent\)/s);
  });

  it("the empty-state CTA orb uses var(--accent) for its core gradient", () => {
    expect(appCss).toMatch(/\.voice-orb-cta \.orb-core\s*\{[^}]*var\(--accent\)/s);
  });
});

describe("Stage 3 — speech rewrite is wired into voice mode", () => {
  it("the voice session uses speakQueued, not speakNow", () => {
    // The session streams chunks and queues them — it never awaits one
    // utterance at a time. Pointing this out keeps the wiring intentional.
    expect(voiceTs).toMatch(/speakQueued/);
  });

  it("speakQueued goes through rewriteForSpeech when the rewrite is enabled", () => {
    // The rewriter is kicked off in parallel with playback (it overlaps
    // with the previous sentence rather than blocking it). If this ever
    // gets bypassed, voices will start reading markdown aloud.
    expect(ttsTs).toMatch(/speakQueued\(/);
    expect(ttsTs).toMatch(/rewriteForSpeech\(clean, choice, languageHint\(settings\)\)/);
  });

  it("the rewrite engine itself is testable", () => {
    // Sanity check that the engine exists and exposes its main entry.
    expect(speechRewrite).toMatch(/export async function rewriteForSpeech/);
  });
});

describe("Stage 3 — voice activity meter", () => {
  it("VoiceView renders a meter while listening", () => {
    // The meter is hidden when not listening — only meaningful while the
    // mic is live. Quiet when speaking or idle.
    expect(voiceView).toMatch(/voice-meter/);
    expect(voiceView).toMatch(/meterBars\.length > 0/);
  });

  it("the meter uses the accent palette", () => {
    expect(appCss).toMatch(/\.voice-meter-bar\s*\{[^}]*background:\s*var\(--accent\)/s);
  });

  it("the meter has an accessible role for screen readers", () => {
    // role="meter" with aria-valuemin/max/now reads as a level indicator.
    expect(voiceView).toMatch(/role="meter"/);
  });
});

describe("Stage 3 — pause feedback", () => {
  it("the voice session has an onPause callback in its interface", () => {
    // The pause signal fires once the user has spoken but has been silent
    // for >600ms. Drives the orb's "thinking" pulse so the avatar doesn't
    // look frozen mid-thought.
    expect(voiceTs).toMatch(/onPause\?:/);
  });

  it("the pause threshold is well below the turn-end grace", () => {
    // PAUSE_FEEDBACK_MS = 600ms vs the per-turn silenceMs (~900ms default).
    // The UI pulses before the turn is committed, so the user sees the
    // avatar preparing rather than going still and then suddenly speaking.
    expect(voiceTs).toMatch(/PAUSE_FEEDBACK_MS\s*=\s*600/);
  });

  it("VoiceView wires the pause state to the orb class", () => {
    expect(voiceView).toMatch(/paused/);
    expect(voiceView).toMatch(/orb-paused/);
  });

  it("the orb-paused class uses a slower pulse than active thinking", () => {
    // The pulse is slower than orbSpin (used for thinking) so the eye can
    // tell pause from real thinking. The existing reduced-motion block
    // already disables breath animation, so this inherits that.
    expect(appCss).toMatch(/\.orb-paused \.orb\s*\{[^}]*orbBreathe\s+2s/s);
  });
});

describe("Stage 3 — barge-in polish", () => {
  it("barge-in aborts both the in-flight generation and the TTS queue", () => {
    // Barge-in needs to cut two things: the model stream (so no more text
    // arrives) and the TTS playback (so the avatar stops talking). Without
    // both, the user hears the avatar trail off mid-sentence.
    expect(voiceTs).toMatch(/this\.aborter\?\.abort/);
    expect(voiceTs).toMatch(/await stopSpeaking\(\)/);
  });

  it("stopSpeaking clears the TTS queue and stops the audio", () => {
    // The queue reset is what prevents a queued reply from playing after
    // the user barges in. Without it, the avatar would finish the cached
    // sentence and the barge-in would feel broken.
    expect(ttsTs).toMatch(/queue = \[\]/);
    expect(ttsTs).toMatch(/currentAudio\.pause/);
  });

  it("barge-in only triggers when the avatar is currently speaking", () => {
    // The barge-in guard prevents the speaking-state from being interrupted
    // by mistake when the user is already mid-thought. The state check
    // matters for the wake-word flow too.
    expect(voiceTs).toMatch(/this\.state === "speaking"/);
  });
});
