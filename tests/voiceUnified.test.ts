/**
 * Stage 2 — unified voice/text sessions.
 *
 * The architectural change: voice mode is a property of the chat, not a
 * separate chat. The orb CTA in the empty state and the Voice button in
 * the composer toggle voiceMode on the chat. VoiceView binds to the
 * current chat (rather than creating a new voice chat) when voiceMode
 * is on. TTS plays in text mode when the user has speakReplies enabled.
 *
 * These tests are the tripwire: they catch a regression where voice mode
 * falls back to the old "navigate to VoiceView" pattern, where the
 * voice-session/chat binding breaks, or where the TTS auto-play falls
 * back to navigates-only.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chatWindow = readFileSync(resolve(__dirname, "..", "src", "components", "ChatWindow.tsx"), "utf8");
const voiceView = readFileSync(resolve(__dirname, "..", "src", "components", "VoiceView.tsx"), "utf8");
const sidebar = readFileSync(resolve(__dirname, "..", "src", "components", "Sidebar.tsx"), "utf8");
const store = readFileSync(resolve(__dirname, "..", "src", "lib", "store.ts"), "utf8");
const tts = readFileSync(resolve(__dirname, "..", "src", "lib", "tts.ts"), "utf8");
const types = readFileSync(resolve(__dirname, "..", "src", "lib", "types.ts"), "utf8");

describe("Stage 2 — voice mode is a chat property", () => {
  it("the Chat schema carries voiceMode", () => {
    expect(types).toMatch(/voiceMode\?:\s*boolean/);
  });

  it("voiceMode is independent of the legacy kind field", () => {
    // Both can coexist on a chat — a migrated chat shows the voice icon
    // because of kind, but voiceMode is the runtime flag.
    expect(types).toMatch(/kind\?:\s*"voice"/);
    expect(types).toMatch(/voiceMode\?:\s*boolean/);
  });

  it("ChatWindow toggles voiceMode from the orb CTA", () => {
    // The orb CTA in the empty state sets voiceMode on the chat rather
    // than just navigating to VoiceView. Voice mode is the persistent
    // flag; the view is the spot to use it.
    expect(chatWindow).toMatch(/updateChatById\(chat\.id, \{ voiceMode: true \}\)/);
  });

  it("ChatWindow toggles voiceMode from the composer Voice button", () => {
    // The composer's Voice button is now a toggle, not just an entry.
    expect(chatWindow).toMatch(/updateChatById\(chat\.id, \{ voiceMode: !chat\.voiceMode \}\)/);
    expect(chatWindow).toMatch(/aria-pressed=\{!!chat\.voiceMode\}/);
  });
});

describe("Stage 2 — voice session binds to the current chat", () => {
  it("VoiceView uses the current chat when voiceMode is on", () => {
    // VoiceView's startFresh checks the current chat's voiceMode flag and
    // binds the session to it when on. No more "voice chat" duplicates.
    expect(voiceView).toMatch(/currentChat\?\.voiceMode/);
    expect(voiceView).toMatch(/targetChatId/);
  });

  it("VoiceView's resume list includes both legacy and new voice chats", () => {
    // Migrated chats (kind="voice") and new voice-mode chats both show
    // up in the resume list so the user can find past spoken sessions.
    expect(voiceView).toMatch(/c\.kind === "voice" \|\| c\.voiceMode/);
  });
});

describe("Stage 2 — sidebar recognises voice-mode chats", () => {
  it("voice-mode chats show the speaker icon", () => {
    expect(sidebar).toMatch(/c\.kind === "voice" \|\| c\.voiceMode/);
  });
});

describe("Stage 2 — TTS auto-play in text mode", () => {
  it("tts.ts exposes a maybeSpeakReply helper", () => {
    expect(tts).toMatch(/export function maybeSpeakReply/);
  });

  it("maybeSpeakReply skips when voiceMode is on", () => {
    // The voice session has its own TTS queue — two queues fighting
    // would be worse than no audio. Skip when voice mode is active.
    expect(tts).toMatch(/if \(opts\.voiceMode\) return/);
  });

  it("the chat hooks the helper after the turn completes", () => {
    // The store calls speakReplyIfWanted in both the single and multi
    // completion paths, so any reply (single or multi-agent) speaks
    // when the user has speakReplies enabled.
    expect(store).toMatch(/speakReplyIfWanted/);
  });
});
