import { describe, expect, it } from "vitest";
import {
  dedupeHosting,
  hostingMatches,
  hostingPerformance,
  parseLinode,
  parseScaleway,
  parseVultr,
  toGpuCandidate,
  toHostingCandidate,
} from "../src/lib/pricing/hosting";
import { FALLBACK_EUR_USD, toUsd, type FxRate } from "../src/lib/pricing/fx";

const AT = "2026-08-17T00:00:00.000Z";
const FX: FxRate = { eurUsd: 1.1567, date: "2026-08-14", stale: false };

describe("parseVultr", () => {
  const payload = {
    plans: [
      {
        id: "vc2-1c-1gb",
        vcpu_count: 1,
        ram: 1024,
        disk: 25,
        disk_type: "SSD",
        bandwidth: 1000,
        monthly_cost: 5,
        hourly_cost: 0.007,
        locations: ["ewr", "fra"],
        gpu_brand: "none",
      },
      {
        id: "vcg-a100-1c",
        vcpu_count: 12,
        ram: 122880,
        monthly_cost: 900,
        hourly_cost: 1.302,
        gpu_brand: "nvidia",
        gpu_type: "A100",
        gpu_vram_gb: 80,
      },
      { id: "no-price", vcpu_count: 1 },
    ],
  };
  const { hosting, gpu } = parseVultr(payload, AT);

  it("reads a VPS plan with disk already in GB", () => {
    expect(hosting).toHaveLength(1);
    expect(hosting[0]).toMatchObject({ diskGB: 25, ramMB: 1024, monthlyUsd: 5, vcpu: 1 });
  });

  it("routes GPU plans to the GPU list", () => {
    expect(gpu).toHaveLength(1);
    expect(gpu[0]).toMatchObject({ gpuModel: "A100", vramGBPerGpu: 80, hourlyUsd: 1.302 });
  });

  it("drops plans with no price", () => {
    expect([...hosting, ...gpu].some((o) => o.id.includes("no-price"))).toBe(false);
  });

  it("survives a malformed payload", () => {
    expect(parseVultr(null, AT)).toEqual({ hosting: [], gpu: [] });
  });
});

describe("parseLinode", () => {
  const payload = {
    data: [
      {
        id: "g6-nanode-1",
        label: "Nanode 1GB",
        price: { hourly: 0.0075, monthly: 5 },
        region_prices: [{ id: "id-cgk", monthly: 6 }],
        memory: 1024,
        disk: 25600, // MB
        transfer: 1000,
        vcpus: 1,
        gpus: 0,
      },
      {
        id: "g1-gpu-rtx6000-1",
        label: "RTX6000 GPU x1",
        price: { hourly: 1.5, monthly: 1000 },
        memory: 32768,
        vcpus: 8,
        gpus: 1,
      },
    ],
  };
  const { hosting, gpu } = parseLinode(payload, AT);

  it("converts disk from MB to GB", () => {
    // The unit trap: Linode's 25600 is MB, Vultr's 25 is GB. Both must land in GB.
    expect(hosting[0].diskGB).toBe(25);
  });

  it("keeps the headline monthly price", () => {
    expect(hosting[0]).toMatchObject({ monthlyUsd: 5, ramMB: 1024, transferGB: 1000 });
  });

  it("routes GPU types to the GPU list", () => {
    expect(gpu).toHaveLength(1);
    expect(gpu[0]).toMatchObject({ gpuCount: 1, hourlyUsd: 1.5 });
  });
});

describe("parseScaleway", () => {
  const payload = {
    products: [
      {
        sku: "/compute/basic3_x2c_4g/run_fr-par-2",
        product: "BASIC3-X2C-4G",
        variant: "BASIC3-X2C-4G - fr-par-2",
        status: "general_availability",
        locality: { zone: "fr-par-2" },
        unit_of_measure: { unit: "hour", size: 1 },
        price: { retail_price: { currency_code: "EUR", units: 0, nanos: 39449000 } },
        properties: {
          hardware: {
            cpu: { virtual: { count: 2 } },
            ram: { size: 4294967296 },
            storage: { total: 0 },
          },
        },
      },
      {
        // Priced per MINUTE, and its cpu block uses `count`, not `virtual.count`.
        sku: "/compute/b300_sxm_8_288g/run_fr-par-2",
        product: "B300-SXM-8-288G",
        variant: "B300-SXM-8-288G - fr-par-2",
        status: "general_availability",
        locality: { zone: "fr-par-2" },
        unit_of_measure: { unit: "minute", size: 1 },
        price: { retail_price: { currency_code: "EUR", units: 1, nanos: 0 } },
        properties: {
          hardware: {
            cpu: { count: 224 },
            ram: { size: 4123168604160 },
            gpu: { count: 8, type: "B300-SXM" },
          },
        },
      },
      // Retired legacy plan — must not be offered as current.
      {
        sku: "/compute/vc1l/run",
        product: "VC1-L",
        status: "retired",
        unit_of_measure: { unit: "hour" },
        price: { retail_price: { currency_code: "EUR", units: 0, nanos: 11000000 } },
        properties: { hardware: { cpu: { virtual: { count: 6 } } } },
      },
      // An add-on, not a machine.
      {
        sku: "/instance/snapshot/l_ssd/fr-par-1",
        status: "general_availability",
        unit_of_measure: { unit: "gigabyte" },
        price: { retail_price: { currency_code: "EUR", units: 0, nanos: 49000 } },
        properties: { instance_local_ssd_snapshot: {} },
      },
    ],
  };
  const { hosting, gpu } = parseScaleway(payload, AT, FX);

  it("keeps only current /compute machines", () => {
    expect(hosting).toHaveLength(1);
    expect(hosting[0].planKey).toBe("/compute/basic3_x2c_4g/run_fr-par-2");
  });

  it("drops retired plans and non-machine SKUs", () => {
    const keys = [...hosting, ...gpu].map((o) => o.id);
    expect(keys.some((k) => k.includes("vc1l"))).toBe(false);
    expect(keys.some((k) => k.includes("snapshot"))).toBe(false);
  });

  it("converts EUR to USD at the supplied rate", () => {
    expect(hosting[0].hourlyUsd).toBeCloseTo(0.039449 * 1.1567, 6);
    expect(hosting[0].quotedCurrency).toBe("EUR");
  });

  it("normalizes a per-minute price to per hour", () => {
    // €1/min is €60/hr, not €1/hr. Getting this wrong makes an 8×B300 node look
    // 60x cheaper than it is.
    expect(gpu).toHaveLength(1);
    expect(gpu[0].hourlyUsd).toBeCloseTo(1 * 60 * 1.1567, 4);
  });

  it("reads a cpu count from either shape", () => {
    expect(hosting[0].vcpu).toBe(2);
    expect(gpu[0].vcpu).toBe(224);
  });

  it("reads RAM and leaves dynamic storage unknown", () => {
    expect(hosting[0].ramMB).toBe(4096);
    // storage.total of 0 means "dynamic", not "zero disk".
    expect(hosting[0].diskGB).toBeUndefined();
  });

  it("does not invent a per-GPU VRAM figure", () => {
    expect(gpu[0].gpuCount).toBe(8);
    expect(gpu[0].gpuModel).toBe("B300-SXM");
    expect(gpu[0].vramGBPerGpu).toBeUndefined();
  });
});

describe("toUsd", () => {
  it("passes USD through untouched", () => {
    expect(toUsd(10, "USD", FX)).toBe(10);
  });
  it("converts EUR at the given rate", () => {
    expect(toUsd(10, "EUR", FX)).toBeCloseTo(11.567, 6);
  });
  it("refuses to guess at a currency it has no rate for", () => {
    expect(toUsd(10, "JPY", FX)).toBeUndefined();
  });
  it("has a pinned fallback rate", () => {
    expect(FALLBACK_EUR_USD.rate).toBeGreaterThan(0.5);
    expect(FALLBACK_EUR_USD.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("dedupeHosting", () => {
  const base = {
    id: "s:a",
    planKey: "a",
    providerSlug: "scaleway",
    providerName: "Scaleway",
    name: "PLAN - fr-par-1",
    vcpu: 2,
    ramMB: 4096,
    monthlyUsd: 10,
    effectiveMonthlyUsd: 10,
    provenance: { source: "t", fetchedAt: AT, kind: "live" as const },
  };

  it("collapses one plan listed per zone into a single row", () => {
    const out = dedupeHosting([
      { ...base, id: "s:a", regions: ["fr-par-1"] },
      { ...base, id: "s:b", name: "PLAN - nl-ams-1", regions: ["nl-ams-1"] },
      { ...base, id: "s:c", name: "PLAN - pl-waw-2", regions: ["pl-waw-2"] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].regions).toEqual(["fr-par-1", "nl-ams-1", "pl-waw-2"]);
  });

  it("keeps zones that genuinely differ in price apart", () => {
    const out = dedupeHosting([
      { ...base, id: "s:a", effectiveMonthlyUsd: 10, regions: ["fr-par-1"] },
      { ...base, id: "s:b", effectiveMonthlyUsd: 12, regions: ["br-gru"] },
    ]);
    expect(out).toHaveLength(2);
  });

  it("keeps different specs apart", () => {
    const out = dedupeHosting([base, { ...base, id: "s:b", ramMB: 8192 }]);
    expect(out).toHaveLength(2);
  });

  it("does not mutate its input", () => {
    const input = [{ ...base, regions: ["a"] }, { ...base, id: "s:b", regions: ["b"] }];
    dedupeHosting(input);
    expect(input[0].regions).toEqual(["a"]);
  });
});

describe("hosting ranking helpers", () => {
  const offer = {
    id: "x:1",
    planKey: "1",
    providerSlug: "x",
    providerName: "X",
    name: "Plan",
    vcpu: 2,
    ramMB: 4096,
    diskGB: 80,
    monthlyUsd: 20,
    effectiveMonthlyUsd: 20,
    provenance: { source: "t", fetchedAt: AT, kind: "live" as const },
  };

  it("filters on minimum resources", () => {
    expect(hostingMatches(offer, { minVcpu: 2 })).toBe(true);
    expect(hostingMatches(offer, { minVcpu: 4 })).toBe(false);
    expect(hostingMatches(offer, { minRamMB: 8192 })).toBe(false);
    expect(hostingMatches(offer, { maxMonthlyUsd: 10 })).toBe(false);
  });

  it("scores a bigger bundle higher", () => {
    const bigger = { ...offer, vcpu: 4, ramMB: 8192 };
    expect(hostingPerformance(bigger)!).toBeGreaterThan(hostingPerformance(offer)!);
  });

  it("returns undefined performance when nothing is published", () => {
    expect(hostingPerformance({ ...offer, vcpu: undefined, ramMB: undefined })).toBeUndefined();
  });

  it("prices a candidate off the effective monthly figure", () => {
    expect(toHostingCandidate(offer).price).toBe(20);
  });

  it("derives an hourly price for a GPU quoted monthly", () => {
    const c = toGpuCandidate({
      id: "g:1",
      offerKey: "1",
      providerSlug: "g",
      providerName: "G",
      name: "GPU",
      monthlyUsd: 730,
      provenance: { source: "t", fetchedAt: AT, kind: "live" },
    });
    expect(c.price).toBeCloseTo(1, 6);
  });
});
