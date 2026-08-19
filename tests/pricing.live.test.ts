/**
 * Live end-to-end check against the real provider feeds.
 *
 * Skipped unless `PRICING_LIVE=1`, because a test that hits four third-party
 * APIs has no business failing someone's build when one of them is having a bad
 * afternoon. Run it deliberately to confirm the upstream schemas haven't moved:
 *
 *   PRICING_LIVE=1 npx vitest run tests/pricing.live.test.ts
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

// The parsers live behind Tauri's HTTP plugin, which isn't present in Node.
// Node's own fetch is a drop-in for what these call sites use.
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: globalThis.fetch }));

const live = process.env.PRICING_LIVE === "1";

describe.skipIf(!live)("live price feeds", () => {
  let sources: typeof import("../src/lib/pricing/sources");
  let hosting: typeof import("../src/lib/pricing/hosting");
  let catalog: typeof import("../src/lib/pricing/catalog");

  beforeAll(async () => {
    sources = await import("../src/lib/pricing/sources");
    hosting = await import("../src/lib/pricing/hosting");
    catalog = await import("../src/lib/pricing/catalog");
  });

  it("fetches and parses thousands of priced models", async () => {
    const results = await sources.fetchModelSources();
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(`  ${r.status.source}: ok=${r.status.ok} n=${r.status.count} ${r.status.ms}ms ${r.status.error ?? ""}`);
    }
    const merged = catalog.mergeModels(results.map((r) => r.models));
    expect(merged.length).toBeGreaterThan(1000);

    // Every record must carry a price and a way to check it.
    for (const m of merged.slice(0, 200)) {
      expect(m.pricing.input !== undefined || m.pricing.output !== undefined).toBe(true);
      expect(m.provenance.fetchedAt).toBeTruthy();
      expect(m.id).toContain(":");
    }
  }, 120_000);

  it("propagates a quality index beyond OpenRouter's own rows", async () => {
    const results = await sources.fetchModelSources();
    const merged = catalog.mergeModels(results.map((r) => r.models));
    const scored = merged.filter((m) => m.quality?.intelligence !== undefined);
    const nonOpenRouter = scored.filter((m) => m.providerSlug !== "openrouter");
    // eslint-disable-next-line no-console
    console.log(`  quality index on ${scored.length} models, ${nonOpenRouter.length} outside OpenRouter`);
    expect(scored.length).toBeGreaterThan(50);
    expect(nonOpenRouter.length).toBeGreaterThan(0);
  }, 120_000);

  it("ranks real models by value without putting unbuyable $0 listings on top", async () => {
    const results = await sources.fetchModelSources();
    const models = catalog.mergeModels(results.map((r) => r.models));
    const cat = { models, hosting: [], gpu: [], fetchedAt: new Date().toISOString(), sources: [] };
    const query = { modality: "llm", requireTools: true, excludeUnpriceable: true };
    const top = catalog.searchModels(cat, query, undefined, 10);

    const byKind = models.reduce<Record<string, number>>((acc, m) => {
      acc[m.pricing.model] = (acc[m.pricing.model] ?? 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log(`  pricing models: ${JSON.stringify(byKind)}`);
    // eslint-disable-next-line no-console
    console.log(`  hidden by excludeUnpriceable: ${catalog.countUnpriceable(cat, query)}`);
    for (const t of top.slice(0, 6)) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${t.candidate.model.name} · ${t.candidate.model.providerName} · $${t.candidate.price}/M · q=${t.candidate.model.quality?.intelligence ?? "-"} · score ${t.score.toFixed(3)}`,
      );
    }

    expect(top.length).toBeGreaterThan(0);
    expect(top[0].score).toBeGreaterThan(0);
    // The whole point of the classification: nothing seat-licensed or
    // unverified may reach the results.
    for (const t of top) {
      expect(["usage", "free"]).toContain(t.candidate.model.pricing.model);
    }
  }, 120_000);

  it("fetches hosting and GPU offers, converting EUR at a dated rate", async () => {
    const infra = await hosting.fetchInfraSources();
    for (const s of infra.statuses) {
      // eslint-disable-next-line no-console
      console.log(`  ${s.source}: ok=${s.ok} n=${s.count} ${s.ms}ms ${s.error ?? ""}`);
    }
    // eslint-disable-next-line no-console
    console.log(`  fx: EUR->USD ${infra.fx.eurUsd} (${infra.fx.date}) stale=${infra.fx.stale}`);
    // eslint-disable-next-line no-console
    console.log(`  hosting=${infra.hosting.length} gpu=${infra.gpu.length}`);

    expect(infra.hosting.length).toBeGreaterThan(10);
    expect(infra.fx.eurUsd).toBeGreaterThan(0.5);

    for (const o of infra.hosting) {
      expect(o.monthlyUsd ?? o.hourlyUsd).toBeDefined();
      // Linode quotes disk in MB and Vultr in GB; both must land in GB here.
      if (o.diskGB !== undefined) expect(o.diskGB).toBeLessThan(100_000);
      // Nothing may reach the table still denominated in a foreign currency.
      if (o.quotedCurrency === "EUR") expect(o.monthlyUsd).toBeGreaterThan(0);
    }

    const byProvider = infra.hosting.reduce<Record<string, number>>((acc, o) => {
      acc[o.providerSlug] = (acc[o.providerSlug] ?? 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log(`  by provider: ${JSON.stringify(byProvider)}`);

    const cheapest = [...infra.hosting]
      .filter((o) => (o.effectiveMonthlyUsd ?? 0) > 0 && o.vcpu)
      .sort((a, b) => a.effectiveMonthlyUsd! - b.effectiveMonthlyUsd!)
      .slice(0, 5);
    for (const o of cheapest) {
      // eslint-disable-next-line no-console
      console.log(
        `  ${o.providerName} ${o.name}: $${o.effectiveMonthlyUsd!.toFixed(2)}/mo · ${o.vcpu} vCPU · ${o.ramMB} MB`,
      );
    }
  }, 120_000);
});
