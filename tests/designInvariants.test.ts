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

  it("animates only the newest message, not the whole transcript", () => {
    // A bare `.msg { animation }` replays on every message when a chat mounts,
    // so opening a long history animates all of it at once. The class is added
    // in ChatWindow to the last message only; both halves have to agree.
    expect(css).toMatch(/\.msg\.msg-new\s*\{[^}]*animation:\s*rise/);
    expect(css).not.toMatch(/^\.msg\s*\{[^}]*animation:/m);

    const chat = readFileSync(resolve(__dirname, "..", "src", "components", "ChatWindow.tsx"), "utf8");
    expect(chat).toContain("msg-new");
  });

  it("gives a dismissed toast an exit to play", () => {
    expect(css).toMatch(/@keyframes toast-out/);
    expect(css).toMatch(/\.toast-slot\.leaving/);
  });

  it("keeps the toast exit duration in step with the store", () => {
    // The store holds the element for TOAST_EXIT_MS and the CSS animates it for
    // --t-base. If those drift apart the toast is either cut off mid-fade or
    // sits invisible for a beat, and neither shows up as a failure anywhere
    // else.
    const base = /--t-base:\s*(\d+)ms/.exec(css)?.[1];
    const toast = readFileSync(resolve(__dirname, "..", "src", "lib", "toast.ts"), "utf8");
    const exit = /TOAST_EXIT_MS\s*=\s*(\d+)/.exec(toast)?.[1];
    expect(base).toBeDefined();
    expect(exit).toBe(base);
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

describe("ui-kit token parity", () => {
  /**
   * packages/ui-kit is a *hand* extraction, not a generated artifact:
   * .design-sync/NOTES.md warns that its token values "were copied from
   * src/App.css at extraction time and can drift", and nothing in the app
   * imports the kit, so drift produces no type error, no build failure and no
   * visible symptom — the design canvas just quietly stops showing what the app
   * looks like.
   *
   * They are in lockstep today. This is the cheap guard that keeps them there:
   * edit a token in App.css without re-syncing the kit and this fails, naming
   * the token.
   */
  const values = (css: string) => {
    const out: Record<string, string[]> = {};
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      (out[m[1]] ??= []).push(m[2].trim());
    }
    return out;
  };

  const kitCss = readFileSync(resolve(__dirname, "..", "packages", "ui-kit", "styles.css"), "utf8");
  const appTokens = values(css);
  const kitTokens = values(kitCss);

  it("defines the same token names in both files", () => {
    expect(Object.keys(kitTokens).sort()).toEqual(Object.keys(appTokens).sort());
  });

  it("gives every shared token the same values, theme block by theme block", () => {
    // Compared as an ordered list per token, so a light-theme override that
    // drifts is caught as well as the dark default.
    for (const name of Object.keys(appTokens)) {
      expect(kitTokens[name], `${name} has drifted between src/App.css and packages/ui-kit/styles.css`).toEqual(
        appTokens[name],
      );
    }
  });
});

describe("ui-kit component parity", () => {
  /**
   * The kit is the bundle source for the design canvas (.design-sync/config.json
   * pins a projectId), so it is a maintained mirror of the app's primitives —
   * not dead code, and not a second implementation the app is meant to adopt.
   * Most of its components have deliberately diverged: the kit's Dialog and
   * Toast take props where the app's read Zustand stores, because the canvas
   * renders them standalone.
   *
   * Two have not diverged at all. Those are the ones worth pinning: an edit to
   * the app copy that isn't mirrored is drift, and drift here is silent for the
   * same reason token drift was — nothing imports the kit, so nothing breaks
   * except the canvas quietly ceasing to show what the app looks like.
   */
  const IDENTICAL = ["EmptyState", "Loading"];

  // CRLF in one copy and LF in the other is not drift; compare by content.
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

  it.each(IDENTICAL)("keeps %s identical between the app and the kit", (name) => {
    expect(
      read(`packages/ui-kit/src/${name}.tsx`),
      `${name}.tsx has drifted between src/components and packages/ui-kit/src — ` +
        `mirror the change into the kit, or move it out of IDENTICAL if the split is intentional`,
    ).toEqual(read(`src/components/${name}.tsx`));
  });
});

describe("no dangling custom properties", () => {
  /**
   * Every var(--x) must resolve to a --x defined somewhere in the sheet.
   *
   * An undefined custom property is the quietest bug in CSS: the declaration is
   * simply dropped, so the element keeps whatever it inherited and the page
   * still renders. Nothing errors, nothing logs. This sheet has already carried
   * --text-2 and --accent-soft, both of which were referenced and never
   * defined, and both of which looked "fine" until someone compared themes.
   *
   * A var() with a fallback is exempt: that is a deliberate default, not a typo.
   */
  const defined = new Set(Array.from(css.matchAll(/(--[a-z0-9-]+)\s*:/g), (m) => m[1]));
  const referenced = Array.from(
    css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g),
    (m) => m[1],
  );

  it("defines every token the sheet references without a fallback", () => {
    const dangling = [...new Set(referenced.filter((n) => !defined.has(n)))].sort();
    expect(dangling, `referenced but never defined in src/App.css: ${dangling.join(", ")}`).toEqual([]);
  });

  it("is actually looking at something", () => {
    // Guards the guard: a regex that silently matched nothing would pass above
    // forever.
    expect(defined.size).toBeGreaterThan(20);
    expect(referenced.length).toBeGreaterThan(100);
  });
});
