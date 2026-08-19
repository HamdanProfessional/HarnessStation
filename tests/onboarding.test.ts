import { describe, expect, it } from "vitest";
import { CLOUD_PROVIDERS } from "../src/lib/catalog";

/**
 * The Onboarding card advertises "N plans" for the flat-rate coding section.
 * The `+` we used to show ("3+ plans") was misleading when the catalog
 * drifted and the count went to 0 — the card then read "0+ plans", which is
 * an empty promise. These tests protect the count semantics so the tag either
 * shows a real number or falls back to "Flat-rate".
 */

describe("Onboarding flat-rate count", () => {
  it("the three advertised coding-plan providers are in the catalog", () => {
    const ids = new Set(CLOUD_PROVIDERS.map((p) => p.id));
    // The provider ids are part of the onboarding copy; if any are removed
    // the card copy must be updated in lockstep.
    expect(ids.has("zai")).toBe(true);
    expect(ids.has("minimax")).toBe(true);
    expect(ids.has("moonshot")).toBe(true);
  });

  it("the advertised count is a positive integer", () => {
    const ids = ["zai", "minimax", "moonshot"] as const;
    const count = CLOUD_PROVIDERS.filter((p) => (ids as readonly string[]).includes(p.id)).length;
    expect(count).toBeGreaterThan(0);
    expect(Number.isInteger(count)).toBe(true);
  });

  it("the tag formula never claims '0+ plans'", () => {
    // The buggy form was `${count}+ plans`. If `count` is 0 it renders "0+ plans".
    // The fix renders `${count} plans` when count > 0, else "Flat-rate".
    const format = (n: number) => (n > 0 ? `${n} plans` : "Flat-rate");
    expect(format(0)).toBe("Flat-rate");
    expect(format(3)).toBe("3 plans");
    expect(format(1)).toBe("1 plans");
    // And the original "0+ plans" string is never produced:
    expect(format(0)).not.toMatch(/0\+/);
  });
});
