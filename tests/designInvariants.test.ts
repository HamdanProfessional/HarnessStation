import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Defensive tests for design invariants that the app quietly depends on.
 * These aren't unit tests of behaviour — they're tripwires that fire when a
 * refactor accidentally drops a CSS rule or token that the JSX relies on.
 */

const css = readFileSync(resolve(__dirname, "..", "src", "App.css"), "utf8");

describe("App.css design invariants", () => {
  it("defines the motion duration tokens", () => {
    expect(css).toMatch(/--t-fast:\s*110ms/);
    expect(css).toMatch(/--t-base:\s*180ms/);
    expect(css).toMatch(/--t-slow:\s*260ms/);
  });

  it("defines the two easing curves", () => {
    expect(css).toMatch(/--ease:\s*cubic-bezier\(0\.22,\s*0\.61,\s*0\.36,\s*1\)/);
    expect(css).toMatch(/--ease-pop:\s*cubic-bezier\(0\.34,\s*1\.36,\s*0\.64,\s*1\)/);
  });

  it("force-hides [hidden] so layout classes can't outrank it", () => {
    // The user-agent rule is `[hidden] { display: none }`, which any class
    // selector outranks. The `!important` re-assertion is intentional and
    // protected — a screenshot in the deploy folder shows what happens when
    // the chat list silently stays visible. Don't remove it.
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it("dark and light themes are both defined", () => {
    expect(css).toMatch(/\[data-theme=["']dark["']\]/);
    expect(css).toMatch(/\[data-theme=["']light["']\]/);
  });

  it("the three accent palettes are defined", () => {
    // Brand colour is independent of canvas — a user can pick any of the
    // three accents on either theme. The picker only shows these three.
    expect(css).toMatch(/\[data-accent=["']indigo["']\]/);
    expect(css).toMatch(/\[data-accent=["']forest["']\]/);
    expect(css).toMatch(/\[data-accent=["']ember["']\]/);
  });

  it("each accent has a light-canvas override for AA contrast", () => {
    // Without the light-canvas override, an accent designed for a dark bg
    // would wash out on white. The override gives a deeper hue for AA.
    expect(css).toMatch(/\[data-theme=["']light["']\]\[data-accent=["']indigo["']\]/);
    expect(css).toMatch(/\[data-theme=["']light["']\]\[data-accent=["']forest["']\]/);
    expect(css).toMatch(/\[data-theme=["']light["']\]\[data-accent=["']ember["']\]/);
  });

  it("the theme picker UI is wired up", () => {
    expect(css).toMatch(/\.theme-swatches/);
    expect(css).toMatch(/\.theme-swatch/);
    expect(css).toMatch(/\.theme-preview/);
    expect(css).toMatch(/\.theme-chip/);
  });

  it("respects prefers-reduced-motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});

describe("theme cycling", () => {
  it("the three theme values are wired through settings.types", () => {
    const types = readFileSync(resolve(__dirname, "..", "src", "lib", "types.ts"), "utf8");
    expect(types).toMatch(/theme:\s*"dark"\s*\|\s*"light"\s*\|\s*"system"/);
  });

  it("the three accent values are wired through settings.types", () => {
    const types = readFileSync(resolve(__dirname, "..", "src", "lib", "types.ts"), "utf8");
    expect(types).toMatch(/accent\?:\s*"indigo"\s*\|\s*"forest"\s*\|\s*"ember"/);
  });

  it("App.tsx mounts data-accent to mirror the settings field", () => {
    const app = readFileSync(resolve(__dirname, "..", "src", "App.tsx"), "utf8");
    expect(app).toMatch(/document\.documentElement\.dataset\.accent/);
  });

  it("the Settings picker exposes both options as data-driven lists", () => {
    const settings = readFileSync(resolve(__dirname, "..", "src", "components", "SettingsView.tsx"), "utf8");
    // Two parallel arrays drive the picker — the picker is generated from THEMES
    // and ACCENTS, not hand-listed. A new palette needs only a CSS rule + array
    // entry, not a JSX change.
    expect(settings).toMatch(/const THEMES:/);
    expect(settings).toMatch(/const ACCENTS:/);
    expect(settings).toMatch(/role="radiogroup"/);
  });
});
