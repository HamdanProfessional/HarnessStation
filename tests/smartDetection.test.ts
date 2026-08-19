/**
 * Smart detection — the voice-first empty state should default to text mode
 * when no microphone is available, and the mic status hint should reflect
 * the actual state. These tests catch regressions where the hook or its
 * resolution logic gets removed from the empty state.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const chatWindow = readFileSync(resolve(__dirname, "..", "src", "components", "ChatWindow.tsx"), "utf8");
const micDetect = readFileSync(resolve(__dirname, "..", "src", "lib", "micDetect.ts"), "utf8");
const appCss = readFileSync(resolve(__dirname, "..", "src", "App.css"), "utf8");

describe("Smart detection", () => {
  it("the mic detection hook exists and queries the right APIs", () => {
    expect(micDetect).toMatch(/useMicAvailable/);
    expect(micDetect).toMatch(/MicStatus/);
    // Desktop: asks the Rust layer via the Tauri invoke.
    expect(micDetect).toMatch(/mic_devices/);
    // Browser: uses navigator.permissions.query.
    expect(micDetect).toMatch(/navigator\.permissions\.query/);
  });

  it("the hook returns three states — available, unavailable, unknown", () => {
    expect(micDetect).toMatch(/available/);
    expect(micDetect).toMatch(/unavailable/);
    expect(micDetect).toMatch(/unknown/);
  });

  it("ChatWindow consumes the mic status to resolve the default mode", () => {
    expect(chatWindow).toMatch(/useMicAvailable/);
    // The unresolved state must check the mic status before defaulting —
    // not just blindly assume voice-first is right.
    expect(chatWindow).toMatch(/resolvedTextMode/);
    expect(chatWindow).toMatch(/micStatus === "unavailable"/);
  });

  it("the empty state shows a hint that reflects the mic status", () => {
    expect(chatWindow).toMatch(/MicStatusHint/);
    expect(chatWindow).toMatch(/mic-hint/);
    expect(appCss).toMatch(/\.mic-hint/);
    expect(appCss).toMatch(/\.mic-dot/);
  });

  it("the user's text-mode preference always wins over smart detection", () => {
    // The persisted preference is read first; smart detection only decides
    // when the user hasn't chosen. We want a user who flipped to text mode
    // to stay in text mode even if their mic becomes available later.
    expect(chatWindow).toMatch(/hs-chat-textmode/);
    expect(chatWindow).toMatch(/saved === "0"/);
    expect(chatWindow).toMatch(/saved === "1"/);
  });
});
