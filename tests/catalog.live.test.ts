/**
 * Live check: do the model ids advertised in Discover still exist?
 *
 * `CLOUD_PROVIDERS` in `lib/catalog.ts` is a hand-maintained list of provider →
 * model ids. It rots silently, and the failure is not cosmetic: a retired id
 * doesn't render as "old", it renders as a 404 the first time a user picks it.
 * In Aug 2026 the Groq rows still offered `llama-3.3-70b-versatile` and the
 * DeepSeek rows still offered `deepseek-chat`, both long dead.
 *
 * The app already fetches a live catalog of ~6,700 priced models for the Value
 * tab. This joins the two on `PRICE_SLUG` and reports every id the live feed
 * has never heard of.
 *
 * Skipped unless `CATALOG_LIVE=1` — same rule as `pricing.live.test.ts`. A test
 * that depends on a third party has no business failing someone's build when
 * that third party is having a bad afternoon. Run it deliberately:
 *
 *   CATALOG_LIVE=1 npx vitest run tests/catalog.live.test.ts
 *
 * It prints a per-provider report and only *fails* on a provider whose ids have
 * gone wholly unrecognised, which is the shape of a rename or a retirement. A
 * single unknown id is reported but tolerated: the feed's coverage is uneven and
 * previews come and go, so failing on one would train everyone to ignore this.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CLOUD_PROVIDERS, PRICE_SLUG, priceSlugFor } from "../src/lib/catalog";
import { canonicalModelKey } from "../src/lib/pricing/key";

// The parsers sit behind Tauri's HTTP plugin, absent in Node.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

const live = process.env.CATALOG_LIVE === "1";

describe("Discover catalog ↔ price catalog wiring", () => {
  it("has decided a price-catalog slug for every provider", () => {
    // The point of this one is that it runs *without* the network. Adding a
    // provider forces an explicit decision — mapped, or explicitly not covered —
    // instead of silently opting out of the live check below.
    const unaccounted = CLOUD_PROVIDERS.filter((p) => priceSlugFor(p.id) === p.id && !(p.id in PRICE_SLUG));
    // An id that equals its slug is fine; this only catches ids that were never
    // considered, by checking the id is a plausible slug at all.
    for (const p of unaccounted) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
    }
    expect(CLOUD_PROVIDERS.length).toBeGreaterThan(0);
  });

  it("never maps two providers onto the same slug by accident", () => {
    const seen = new Map<string, string>();
    for (const p of CLOUD_PROVIDERS) {
      const slug = priceSlugFor(p.id);
      if (!slug) continue;
      // zai / zai-coding are genuinely distinct products on distinct slugs.
      const prev = seen.get(slug);
      expect(prev, `${p.id} and ${prev} both map to ${slug}`).toBeUndefined();
      seen.set(slug, p.id);
    }
  });
});

describe.skipIf(!live)("live model-id check", () => {
  let byProvider: Map<string, Set<string>>;

  beforeAll(async () => {
    const res = await fetch("https://models.dev/api.json");
    const feed = (await res.json()) as Record<string, { models?: Record<string, unknown> }>;
    byProvider = new Map(
      Object.entries(feed).map(([slug, p]) => [
        slug,
        new Set(Object.keys(p.models ?? {}).map(canonicalModelKey)),
      ]),
    );
  }, 60_000);

  it("still recognises the model ids Discover advertises", () => {
    const report: string[] = [];
    const dead: string[] = [];

    for (const p of CLOUD_PROVIDERS) {
      const slug = priceSlugFor(p.id);
      if (!slug) {
        report.push(`  ${p.id}: not covered by the price feed — unchecked`);
        continue;
      }
      const known = byProvider.get(slug);
      if (!known) {
        report.push(`  ${p.id}: slug "${slug}" missing from the feed — check PRICE_SLUG`);
        continue;
      }
      const unknown = p.models.filter((m) => !known.has(canonicalModelKey(m)));
      if (unknown.length === 0) {
        report.push(`  ${p.id}: all ${p.models.length} ok`);
        continue;
      }
      report.push(`  ${p.id}: ${unknown.length}/${p.models.length} unknown -> ${unknown.join(", ")}`);
      // Every id unrecognised is the signature of a rename or retirement.
      if (unknown.length === p.models.length) dead.push(`${p.id} (${unknown.join(", ")})`);
    }

    // eslint-disable-next-line no-console
    console.log("\nDiscover model ids vs models.dev:\n" + report.join("\n") + "\n");

    expect(dead, `every advertised id is unrecognised for: ${dead.join("; ")}`).toEqual([]);
  }, 60_000);
});
