/**
 * Voice-first is the brand promise. The empty chat state surfaces the orb
 * CTA, the composer carries a persistent "Voice" button, and the VoiceView
 * is reachable from both. These tests catch accidental regressions where
 * any of those entry points get removed.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chatWindow = readFileSync(resolve(__dirname, "..", "src", "components", "ChatWindow.tsx"), "utf8");
const appCss = readFileSync(resolve(__dirname, "..", "src", "App.css"), "utf8");

describe("Voice-first entry points", () => {
  it("ChatWindow renders the voice orb CTA in the empty state", () => {
    // The orb is the primary action on the empty chat — not the LogoMark.
    expect(chatWindow).toMatch(/voice-orb-cta/);
    expect(chatWindow).toMatch(/Press to talk/);
  });

  it("ChatWindow has a Type-instead toggle off the voice-first empty state", () => {
    // Voice is the headline; text mode is one click away, not equal.
    expect(chatWindow).toMatch(/Type instead/);
    expect(chatWindow).toMatch(/textMode/);
  });

  it("ChatWindow has a persistent Voice button in the composer", () => {
    // Distinct from "Dictate" — this opens the full VoiceView, not a one-shot
    // STT pass into the textfield.
    expect(chatWindow).toMatch(/composer-mic/);
    expect(chatWindow).toMatch(/Open voice mode/);
  });

  it("the orb CTA opens the VoiceView (not a half-baked embedded mode)", () => {
    // The wider-audience path is: click orb → land in the existing VoiceView.
    // Hoping to grow that into a custom in-chat voice mode is a v2 problem.
    expect(chatWindow).toMatch(/openVoice/);
    expect(chatWindow).toMatch(/setView\("voice"\)/);
  });

  it("the orb CTA is styled in the design system, not ad-hoc", () => {
    // The CTA reuses the same orb shapes and breathe animation as VoiceView's
    // orb so the brand promise is consistent across surfaces.
    expect(appCss).toMatch(/\.voice-orb-cta/);
    expect(appCss).toMatch(/\.voice-orb-cta \.orb-core/);
    // Reduced-motion: the orb's breathing animation should not run for users
    // who have asked for less motion. The exact rule may evolve, but the
    // existence of the override is what we want to protect.
    expect(appCss).toMatch(/prefers-reduced-motion:[\s\S]{0,200}voice-orb-cta/);
  });

  it("the text-mode preference persists across launches", () => {
    // A user who prefers text doesn't have to flip the toggle every chat.
    expect(chatWindow).toMatch(/hs-chat-textmode/);
  });
});
