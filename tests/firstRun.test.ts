import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, ESSENTIALS_HIDDEN, ESSENTIALS_PROFILE_ID } from "../src/lib/storage";
import { NAV_VIEWS, VIEWS } from "../src/lib/views";

describe("Essentials profile", () => {
  it("hides only view ids that actually exist", () => {
    // A renamed view would otherwise turn an entry here into a silent no-op:
    // the sidebar would quietly grow back without anyone noticing.
    const known = new Set(VIEWS.map((v) => v.id));
    for (const id of ESSENTIALS_HIDDEN) expect(known).toContain(id);
  });

  it("only hides views that have a sidebar entry to hide", () => {
    const navIds = new Set(NAV_VIEWS.map((v) => v.id));
    for (const id of ESSENTIALS_HIDDEN) expect(navIds).toContain(id);
  });

  it("leaves a first-run user three nav destinations", () => {
    const hidden = new Set<string>(ESSENTIALS_HIDDEN);
    const visible = NAV_VIEWS.filter((v) => !hidden.has(v.id)).map((v) => v.id);
    // Discover (how you connect a model), My Models, Tools. Chat and Settings
    // are not views and are always present.
    expect(visible).toEqual(["discover", "models", "tools"]);
  });

  it("ships active on a fresh install", () => {
    expect(DEFAULT_SETTINGS.activeProfileId).toBe(ESSENTIALS_PROFILE_ID);
    const profile = DEFAULT_SETTINGS.profiles?.find((p) => p.id === ESSENTIALS_PROFILE_ID);
    expect(profile).toBeDefined();
    expect(profile!.hiddenViews).toEqual([...ESSENTIALS_HIDDEN]);
  });

  it("hides nothing that cannot be turned back on", () => {
    // Every hidden view stays in the registry, so clearing the profile restores
    // it — the profile is a default, not a removal.
    const known = new Set(VIEWS.map((v) => v.id));
    for (const id of ESSENTIALS_HIDDEN) expect(known.has(id)).toBe(true);
  });

  it("does not hide the default chat surface or settings", () => {
    const hidden = new Set<string>(ESSENTIALS_HIDDEN);
    expect(hidden.has("chat")).toBe(false);
    expect(hidden.has("settings")).toBe(false);
  });
});
