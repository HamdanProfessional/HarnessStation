import { describe, expect, it } from "vitest";
import { hasEdits, mergeEdits } from "../src/lib/settingsMerge";
import type { Settings } from "../src/lib/types";

const base = (over: Partial<Settings> = {}): Settings =>
  ({
    providers: [],
    globalInstructions: "",
    theme: "dark",
    ...over,
  }) as Settings;

describe("saving an edited settings form", () => {
  it("applies what the user changed", () => {
    const baseline = base({ theme: "dark" });
    const draft = base({ theme: "light" });
    expect(mergeEdits(baseline, draft, baseline).theme).toBe("light");
  });

  it("keeps a sibling panel's save that landed while the form was open", () => {
    // The actual bug: paste a Discord token in Channels (which saves itself),
    // switch to General, tick a box, press Save. The token used to vanish.
    const baseline = base({ theme: "dark" });
    const live = base({ theme: "dark", channels: { discord: { token: "secret" } } } as Partial<Settings>);
    const draft = base({ theme: "light" });

    const out = mergeEdits(baseline, draft, live) as Settings & { channels?: unknown };
    expect(out.channels).toEqual({ discord: { token: "secret" } });
    expect(out.theme).toBe("light");
  });

  it("lets the user's edit win when both changed the same key", () => {
    // They are looking at the form and pressed Save. That is the more recent
    // intent, and silently discarding it would be its own surprise.
    const baseline = base({ globalInstructions: "old" });
    const live = base({ globalInstructions: "changed elsewhere" });
    const draft = base({ globalInstructions: "mine" });
    expect(mergeEdits(baseline, draft, live).globalInstructions).toBe("mine");
  });

  it("does not resurrect a key the user cleared", () => {
    // Deleting a provider has to stick, or it reappears on the next render.
    const baseline = base({ aaApiKey: "k" });
    const draft = base();
    delete (draft as Partial<Settings>).aaApiKey;
    expect("aaApiKey" in mergeEdits(baseline, draft, baseline)).toBe(false);
  });

  it("carries through a key the form never knew about", () => {
    // A setting added by a sibling panel after this form mounted is not in the
    // baseline or the draft, and must survive untouched.
    const baseline = base();
    const live = base({ localApi: { port: 11435 } } as Partial<Settings>);
    const draft = base();
    expect(mergeEdits(baseline, draft, live)).toMatchObject({ localApi: { port: 11435 } });
  });

  it("changes nothing when the user edited nothing", () => {
    const baseline = base({ theme: "dark" });
    const live = base({ theme: "light", monthlyCapUsd: 5 });
    expect(mergeEdits(baseline, baseline, live)).toEqual(live);
  });

  it("treats a deep change inside an array as a change", () => {
    const baseline = base({ providers: [{ id: "a", models: ["x"] }] as Settings["providers"] });
    const draft = base({ providers: [{ id: "a", models: ["x", "y"] }] as Settings["providers"] });
    expect(mergeEdits(baseline, draft, baseline).providers[0].models).toEqual(["x", "y"]);
  });

  it("does not treat an unchanged nested object as edited", () => {
    // A false positive here would push a stale copy over a sibling's newer one,
    // which is the original bug wearing a different hat.
    const nested = { voice: { speechProviderId: "p1" } } as Partial<Settings>;
    const baseline = base(nested);
    const draft = base(structuredClone(nested));
    const live = base({ voice: { speechProviderId: "p2" } } as Partial<Settings>);
    expect(mergeEdits(baseline, draft, live)).toMatchObject({ voice: { speechProviderId: "p2" } });
  });

  it("does not mutate any of its inputs", () => {
    const baseline = base({ theme: "dark" });
    const draft = base({ theme: "light" });
    const live = base({ theme: "dark" });
    mergeEdits(baseline, draft, live);
    expect(live.theme).toBe("dark");
    expect(baseline.theme).toBe("dark");
  });
});

describe("the unsaved-changes indicator", () => {
  it("is off when the form has not been touched", () => {
    const b = base({ theme: "dark" });
    expect(hasEdits(b, structuredClone(b))).toBe(false);
  });

  it("is on once the user edits something", () => {
    expect(hasEdits(base({ theme: "dark" }), base({ theme: "light" }))).toBe(true);
  });

  it("stays off when only a sibling panel saved", () => {
    // It used to light up in this case, advertising unsaved work that did not
    // exist and inviting the click that destroyed the sibling's save.
    const baseline = base({ theme: "dark" });
    const draft = structuredClone(baseline);
    expect(hasEdits(baseline, draft)).toBe(false);
  });
});
