import { describe, expect, it } from "vitest";
import {
  authBadge,
  dotState,
  pageStats,
  probeBadge,
  providerBadges,
  type ProbeState,
} from "../src/lib/providerStatus";

/**
 * My Models claims things about providers the user cannot verify from the page
 * — reachable, keyed, how many models. Every one of these rules is a claim that
 * is worse than useless if it is confidently wrong.
 */

describe("the connection dot", () => {
  it("separates never-checked from failing", () => {
    // Colouring unchecked red would tell every user on first load that their
    // working setup is broken.
    expect(dotState(undefined)).toBe("unknown");
    expect(dotState({ state: "error", error: "401" })).toBe("bad");
  });

  it("reports ok and in-flight distinctly", () => {
    expect(dotState({ state: "ok", count: 3 })).toBe("on");
    expect(dotState({ state: "checking" })).toBe("checking");
  });
});

describe("the auth badge", () => {
  it("says local rather than asking for a key that is not needed", () => {
    const b = authBadge({ localish: true, hasKey: false });
    expect(b.label).toBe("Local");
    expect(b.tone).toBe("neutral");
  });

  it("warns when a remote provider has no key", () => {
    expect(authBadge({ localish: false, hasKey: false })).toMatchObject({ label: "No key", tone: "warn" });
  });

  it("confirms a key without claiming it works", () => {
    // "Key set" is all we know before a probe — a stored key can still be
    // revoked, and saying "Connected" here would be an unverified claim.
    expect(authBadge({ localish: false, hasKey: true })).toMatchObject({ label: "Key set", tone: "ok" });
  });

  it("names a subscription provider as a subscription, not a key", () => {
    // The apiKey field holds the "oauth" marker on these, so without this rule
    // the card would claim "Key set" about a provider that has no API key.
    expect(authBadge({ localish: false, hasKey: true, auth: "oauth-claude" })).toMatchObject({
      label: "Subscription",
      tone: "ok",
    });
    expect(authBadge({ localish: false, hasKey: true, auth: "oauth-copilot" }).title).toContain("keychain");
  });
});

describe("the probe badge", () => {
  it("is absent before anything has been checked", () => {
    // Most providers start unchecked; a "Not checked" pill on each would be
    // noise, and the grey dot already carries it.
    expect(probeBadge(undefined)).toBeNull();
  });

  it("reports the model count on success", () => {
    expect(probeBadge({ state: "ok", count: 47 })?.label).toBe("Answered · 47 models");
  });

  it("gets the singular right", () => {
    expect(probeBadge({ state: "ok", count: 1 })?.label).toBe("Answered · 1 model");
  });

  it("survives a success with no count", () => {
    expect(probeBadge({ state: "ok" })?.label).toBe("Answered · 0 models");
  });

  it("truncates a long error but keeps the whole thing on hover", () => {
    // Providers return whole HTTP bodies as error text; unbounded, one failure
    // would stretch the card past the column.
    const long = "x".repeat(300);
    const b = probeBadge({ state: "error", error: long });
    expect(b?.tone).toBe("danger");
    expect(b!.label.length).toBeLessThanOrEqual(60);
    expect(b?.title).toBe(long);
  });

  it("falls back to a word when the error is empty", () => {
    // A failed fetch can reject with no message, and an empty red pill says
    // nothing at all.
    expect(probeBadge({ state: "error", error: "" })?.label).toBe("Failed");
    expect(probeBadge({ state: "error" })?.label).toBe("Failed");
  });
});

describe("the badge set for a card", () => {
  it("always shows how it authenticates", () => {
    expect(providerBadges({ localish: false, hasKey: true })).toHaveLength(1);
  });

  it("adds the probe result once there is one", () => {
    const b = providerBadges({ localish: false, hasKey: true, probe: { state: "ok", count: 2 } });
    expect(b.map((x) => x.tone)).toEqual(["ok", "ok"]);
  });
});

describe("the summary numbers", () => {
  const providers = [
    { id: "a", apiKey: "k", models: ["gpt-4", "gpt-3"] },
    { id: "b", apiKey: "", models: ["gpt-4", "llama"] },
    { id: "c", apiKey: "k", models: [] },
  ];

  it("counts distinct models, not the sum across providers", () => {
    // gpt-4 is listed twice. Summing would claim 4 models where 3 exist —
    // and two providers sharing an id is exactly the round-robin case.
    expect(pageStats(providers, {}).models).toBe(3);
  });

  it("counts only providers that actually answered", () => {
    const probes: Record<string, ProbeState> = {
      a: { state: "ok", count: 2 },
      b: { state: "error", error: "401" },
      c: { state: "checking" },
    };
    const s = pageStats(providers, probes);
    expect(s.connected).toBe(1);
    expect(s.total).toBe(3);
  });

  it("counts the ones still missing a key", () => {
    expect(pageStats(providers, {}).needKey).toBe(1);
  });

  it("does not treat a whitespace key as a key", () => {
    expect(pageStats([{ id: "x", apiKey: "   ", models: [] }], {}).needKey).toBe(1);
  });

  it("returns zeroes for an empty page rather than throwing", () => {
    expect(pageStats([], {})).toEqual({ connected: 0, total: 0, models: 0, needKey: 0 });
  });
});
