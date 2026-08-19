/**
 * Hosting and GPU price sources.
 *
 * Both feeds are public and unauthenticated, and both quote in USD, so no
 * currency conversion is needed yet. (`HostingOffer` carries `quotedCurrency` /
 * `quotedAmount` for the day an EUR provider like OVH or Scaleway is added —
 * comparing EUR to USD without a dated rate is silently wrong, so those must
 * arrive together with an FX table, not before.)
 *
 * **CORS.** Linode sends `Access-Control-Allow-Origin: *` and works everywhere.
 * Vultr sends no CORS headers, so it succeeds on desktop — where the Rust HTTP
 * client is not subject to the same-origin policy — and fails in the browser
 * build. That failure is reported per-source rather than swallowed, so the web
 * build shows "Vultr unreachable from the browser" instead of a silently
 * shorter list.
 *
 * Units are normalized here and nowhere else: Linode quotes disk in MB, Vultr
 * in GB. Two feeds disagreeing about what "disk: 25600" means is exactly the
 * kind of thing that produces a confidently wrong comparison.
 */

import { fetch } from "@tauri-apps/plugin-http";
import { fetchFxRate, toUsd, type FxRate } from "./fx";
import { quantize, toNumber } from "./money";
import type { GpuOffer, HostingOffer, SourceStatus } from "./types";

export const VULTR_PLANS_URL = "https://api.vultr.com/v2/plans?per_page=500";
export const LINODE_TYPES_URL = "https://api.linode.com/v4/linode/types";

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "HarnessStation" }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Vultr
// ---------------------------------------------------------------------------

interface VultrPlan {
  id?: string;
  vcpu_count?: number;
  ram?: number; // MB
  disk?: number; // GB
  disk_type?: string;
  bandwidth?: number; // GB
  monthly_cost?: number;
  hourly_cost?: number;
  type?: string;
  locations?: string[];
  gpu_brand?: string;
  gpu_type?: string;
  gpu_vram_gb?: number;
}

export function parseVultr(payload: unknown, fetchedAt: string): {
  hosting: HostingOffer[];
  gpu: GpuOffer[];
} {
  const plans = (payload as { plans?: VultrPlan[] })?.plans;
  if (!Array.isArray(plans)) return { hosting: [], gpu: [] };

  const hosting: HostingOffer[] = [];
  const gpu: GpuOffer[] = [];

  for (const p of plans) {
    const planKey = String(p.id ?? "");
    if (!planKey) continue;
    const monthly = toNumber(p.monthly_cost);
    const hourly = toNumber(p.hourly_cost);
    // An offer with no price is not a ranked offer.
    if (monthly === undefined && hourly === undefined) continue;

    const provenance = {
      source: "vultr",
      sourceUrl: "https://www.vultr.com/pricing/",
      fetchedAt,
      kind: "live" as const,
    };
    const isGpu = !!p.gpu_brand && p.gpu_brand.toLowerCase() !== "none";

    if (isGpu) {
      gpu.push({
        id: `vultr:${planKey}`,
        offerKey: planKey,
        providerSlug: "vultr",
        providerName: "Vultr",
        name: planKey,
        gpuModel: p.gpu_type || p.gpu_brand,
        vramGBPerGpu: toNumber(p.gpu_vram_gb),
        vcpu: toNumber(p.vcpu_count),
        ramMB: toNumber(p.ram),
        hourlyUsd: hourly,
        monthlyUsd: monthly,
        availability: "available",
        regions: p.locations,
        provenance,
      });
      continue;
    }

    hosting.push({
      id: `vultr:${planKey}`,
      planKey,
      providerSlug: "vultr",
      providerName: "Vultr",
      name: planKey,
      vcpu: toNumber(p.vcpu_count),
      ramMB: toNumber(p.ram),
      diskGB: toNumber(p.disk), // Vultr quotes GB directly
      diskType: p.disk_type,
      transferGB: toNumber(p.bandwidth),
      monthlyUsd: monthly,
      hourlyUsd: hourly,
      effectiveMonthlyUsd: monthly,
      quotedCurrency: "USD",
      quotedAmount: monthly,
      regions: p.locations,
      provenance,
    });
  }
  return { hosting, gpu };
}

// ---------------------------------------------------------------------------
// Linode
// ---------------------------------------------------------------------------

interface LinodeType {
  id?: string;
  label?: string;
  price?: { hourly?: number; monthly?: number };
  region_prices?: { id?: string; hourly?: number; monthly?: number }[];
  addons?: { backups?: { price?: { monthly?: number } } };
  memory?: number; // MB
  disk?: number; // MB
  transfer?: number; // GB
  vcpus?: number;
  gpus?: number;
  class?: string;
  successor?: string | null;
}

export function parseLinode(payload: unknown, fetchedAt: string): {
  hosting: HostingOffer[];
  gpu: GpuOffer[];
} {
  const rows = (payload as { data?: LinodeType[] })?.data;
  if (!Array.isArray(rows)) return { hosting: [], gpu: [] };

  const hosting: HostingOffer[] = [];
  const gpu: GpuOffer[] = [];

  for (const t of rows) {
    const planKey = String(t.id ?? "");
    if (!planKey) continue;
    const monthly = toNumber(t.price?.monthly);
    const hourly = toNumber(t.price?.hourly);
    if (monthly === undefined && hourly === undefined) continue;

    const provenance = {
      source: "linode",
      sourceUrl: "https://www.linode.com/pricing/",
      fetchedAt,
      kind: "live" as const,
    };
    const regions = t.region_prices?.map((r) => String(r.id)).filter(Boolean);

    if ((t.gpus ?? 0) > 0) {
      gpu.push({
        id: `linode:${planKey}`,
        offerKey: planKey,
        providerSlug: "linode",
        providerName: "Linode",
        name: t.label || planKey,
        gpuCount: toNumber(t.gpus),
        vcpu: toNumber(t.vcpus),
        ramMB: toNumber(t.memory),
        hourlyUsd: hourly,
        monthlyUsd: monthly,
        availability: "available",
        regions,
        provenance,
      });
      continue;
    }

    // Linode quotes disk in MB; the model stores GB.
    const diskMB = toNumber(t.disk);
    hosting.push({
      id: `linode:${planKey}`,
      planKey,
      providerSlug: "linode",
      providerName: "Linode",
      name: t.label || planKey,
      vcpu: toNumber(t.vcpus),
      ramMB: toNumber(t.memory),
      diskGB: diskMB === undefined ? undefined : quantize(diskMB / 1024),
      transferGB: toNumber(t.transfer),
      monthlyUsd: monthly,
      hourlyUsd: hourly,
      effectiveMonthlyUsd: monthly,
      quotedCurrency: "USD",
      quotedAmount: monthly,
      regions,
      provenance,
    });
  }
  return { hosting, gpu };
}

// ---------------------------------------------------------------------------
// Scaleway
// ---------------------------------------------------------------------------

/**
 * Scaleway's public catalog is one flat SKU list covering everything the
 * company sells — snapshots, object storage, IPs, instances. Only the
 * `/instance/server/...` SKUs are actual rentable machines with an hourly
 * price; the rest would otherwise arrive as nonsense "plans" costing €0.000049.
 *
 * Prices are EUR as `units` + `nanos`, and hourly. Both conversions happen here.
 *
 * OVH is deliberately **not** implemented. Its public order catalog
 * (`/order/catalog/public/vps`) publishes plan names and prices but no
 * technical specification at all — 0 of 197 plans carry CPU, RAM or disk. A row
 * with a price and no specs cannot be compared on value, and showing a €2.99
 * plan of unknown size above a known 2-vCPU/4 GB one would be exactly the
 * confidently-wrong comparison this feature exists to avoid.
 */
export const SCALEWAY_BASE =
  "https://api.scaleway.com/product-catalog/v2alpha1/public-catalog/products";
/** The API caps a page at 1,000; the catalog is ~5,500 SKUs, so six pages. */
export const SCALEWAY_PAGE_SIZE = 1000;
export const SCALEWAY_MAX_PAGES = 6;

interface ScalewaySku {
  sku?: string;
  product?: string;
  variant?: string;
  description?: string;
  status?: string;
  locality?: { zone?: string };
  unit_of_measure?: { unit?: string; size?: number };
  price?: { retail_price?: { currency_code?: string; units?: number; nanos?: number } };
  properties?: {
    hardware?: {
      cpu?: { count?: number; virtual?: { count?: number }; threads?: number };
      ram?: { size?: number };
      storage?: { total?: number };
      gpu?: { count?: number; type?: string; description?: string };
    };
  };
}

/**
 * Multiplier converting a price quoted per `unit` into a price per hour.
 *
 * Not cosmetic: Scaleway quotes standard instances per hour but its GPU SKUs
 * per *minute*. Treating both as hourly would have priced an 8×B300 node at
 * €1/hour instead of €60/hour — off by 60x, and in the direction that makes it
 * look like the bargain of the century.
 */
const PER_HOUR: Record<string, number> = {
  second: 3600,
  minute: 60,
  hour: 1,
  day: 1 / 24,
  month: 1 / 730,
};

/** EUR from Scaleway's units + nanos representation. */
function scalewayEur(price: ScalewaySku["price"]): number | undefined {
  const retail = price?.retail_price;
  if (!retail) return undefined;
  const units = toNumber(retail.units) ?? 0;
  const nanos = toNumber(retail.nanos) ?? 0;
  const value = units + nanos / 1e9;
  return value > 0 ? value : undefined;
}

export function parseScaleway(
  payload: unknown,
  fetchedAt: string,
  fx: FxRate,
): { hosting: HostingOffer[]; gpu: GpuOffer[] } {
  const rows = (payload as { products?: ScalewaySku[] })?.products;
  if (!Array.isArray(rows)) return { hosting: [], gpu: [] };

  const hosting: HostingOffer[] = [];
  const gpu: GpuOffer[] = [];

  for (const s of rows) {
    const sku = String(s.sku ?? "");
    // Current rentable machines live under /compute/. The /instance/server/
    // SKUs in this catalog are all retired legacy plans, and /network,
    // /storage and friends are add-ons rather than machines.
    if (!sku.startsWith("/compute/")) continue;
    if (s.status !== "general_availability") continue;

    const hw = s.properties?.hardware;
    const vcpu =
      toNumber(hw?.cpu?.virtual?.count) ?? toNumber(hw?.cpu?.count) ?? toNumber(hw?.cpu?.threads);
    // Without a CPU count there is nothing to compare the price against.
    if (vcpu === undefined) continue;

    const quoted = scalewayEur(s.price);
    if (quoted === undefined) continue;
    const unit = (s.unit_of_measure?.unit ?? "hour").toLowerCase();
    const perHour = PER_HOUR[unit];
    // A billing unit we do not recognise is not one we may guess at.
    if (perHour === undefined) continue;

    const currency = s.price?.retail_price?.currency_code ?? "EUR";
    const eurPerHour = quoted * perHour;
    const hourlyUsd = toUsd(eurPerHour, currency, fx);
    if (hourlyUsd === undefined) continue;

    const ramBytes = toNumber(hw?.ram?.size);
    const storageBytes = toNumber(hw?.storage?.total);
    const zone = s.locality?.zone;

    const provenance = {
      source: "scaleway",
      sourceUrl: "https://www.scaleway.com/en/pricing/",
      fetchedAt,
      kind: "live" as const,
    };
    const name = s.variant || s.product || sku;
    const gpuCount = toNumber(hw?.gpu?.count);

    if (gpuCount && gpuCount > 0) {
      gpu.push({
        id: `scaleway:${sku}`,
        offerKey: sku,
        providerSlug: "scaleway",
        providerName: "Scaleway",
        name,
        gpuModel: hw?.gpu?.type,
        gpuCount,
        // Scaleway publishes no per-GPU VRAM figure. The SKU embeds a number
        // (`b300_sxm_8_288g`) but whether that is per-card or aggregate is not
        // stated, so it is left unknown rather than guessed at.
        vcpu,
        ramMB: ramBytes === undefined ? undefined : quantize(ramBytes / 1024 ** 2),
        hourlyUsd,
        monthlyUsd: quantize(hourlyUsd * 730),
        availability: "available",
        regions: zone ? [zone] : undefined,
        provenance,
      });
      continue;
    }

    hosting.push({
      id: `scaleway:${sku}`,
      planKey: sku,
      providerSlug: "scaleway",
      providerName: "Scaleway",
      name,
      vcpu,
      ramMB: ramBytes === undefined ? undefined : quantize(ramBytes / 1024 ** 2),
      diskGB:
        storageBytes === undefined || storageBytes === 0
          ? undefined
          : quantize(storageBytes / 1024 ** 3),
      hourlyUsd,
      // Scaleway bills hourly; 730 h is the conventional month used by every
      // provider that quotes both, so the two columns stay comparable.
      monthlyUsd: quantize(hourlyUsd * 730),
      effectiveMonthlyUsd: quantize(hourlyUsd * 730),
      quotedCurrency: currency,
      // The provider's own figure, normalized to per hour but not converted —
      // keeping it makes a converted price checkable against the source page.
      quotedAmount: quantize(eurPerHour),
      regions: zone ? [zone] : undefined,
      provenance,
    });
  }
  return { hosting, gpu };
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

export interface InfraResult {
  hosting: HostingOffer[];
  gpu: GpuOffer[];
  statuses: SourceStatus[];
  /** The rate European prices were converted at, so the UI can show it. */
  fx: FxRate;
}

async function runSource(
  source: string,
  url: string,
  parse: (payload: unknown, fetchedAt: string) => { hosting: HostingOffer[]; gpu: GpuOffer[] },
  signal?: AbortSignal,
): Promise<{ hosting: HostingOffer[]; gpu: GpuOffer[]; status: SourceStatus }> {
  const started = Date.now();
  const fetchedAt = new Date().toISOString();
  try {
    const { hosting, gpu } = parse(await getJson(url, signal), fetchedAt);
    return {
      hosting,
      gpu,
      status: {
        source,
        ok: true,
        count: hosting.length + gpu.length,
        fetchedAt,
        ms: Date.now() - started,
      },
    };
  } catch (e) {
    return {
      hosting: [],
      gpu: [],
      status: {
        source,
        ok: false,
        count: 0,
        error: (e as Error).message || String(e),
        fetchedAt,
        ms: Date.now() - started,
      },
    };
  }
}

/**
 * Scaleway needs paging: the catalog is one flat ~5,500-SKU list with no
 * server-side category filter that works, and a page caps at 1,000.
 *
 * Pages are fetched concurrently and a page that fails is skipped rather than
 * failing the whole source — a partial Scaleway list is still worth showing,
 * and the count in the status line makes it obvious if one went missing.
 */
async function fetchScaleway(
  fx: FxRate,
  signal?: AbortSignal,
): Promise<{ hosting: HostingOffer[]; gpu: GpuOffer[]; status: SourceStatus }> {
  const started = Date.now();
  const fetchedAt = new Date().toISOString();
  try {
    const pages = await Promise.all(
      Array.from({ length: SCALEWAY_MAX_PAGES }, (_, i) =>
        getJson(`${SCALEWAY_BASE}?page_size=${SCALEWAY_PAGE_SIZE}&page=${i + 1}`, signal).catch(
          () => null,
        ),
      ),
    );
    const ok = pages.filter(Boolean);
    if (ok.length === 0) throw new Error("every page failed");

    const hosting: HostingOffer[] = [];
    const gpu: GpuOffer[] = [];
    for (const page of ok) {
      const parsed = parseScaleway(page, fetchedAt, fx);
      hosting.push(...parsed.hosting);
      gpu.push(...parsed.gpu);
    }
    return {
      hosting,
      gpu,
      status: {
        source: "scaleway",
        ok: true,
        count: hosting.length + gpu.length,
        fetchedAt,
        ms: Date.now() - started,
        error: ok.length < SCALEWAY_MAX_PAGES ? `${SCALEWAY_MAX_PAGES - ok.length} pages failed` : undefined,
      },
    };
  } catch (e) {
    return {
      hosting: [],
      gpu: [],
      status: {
        source: "scaleway",
        ok: false,
        count: 0,
        error: (e as Error).message || String(e),
        fetchedAt,
        ms: Date.now() - started,
      },
    };
  }
}

/** Fetch hosting and GPU sources concurrently, reporting each outcome. */
export async function fetchInfraSources(signal?: AbortSignal): Promise<InfraResult> {
  // The rate is needed before Scaleway can be normalized, and is cheap; if it
  // fails, `fetchFxRate` returns the cache or the pin marked stale rather than
  // dropping every European provider.
  const fx = await fetchFxRate(signal);

  const results = await Promise.all([
    runSource("vultr", VULTR_PLANS_URL, parseVultr, signal),
    runSource("linode", LINODE_TYPES_URL, parseLinode, signal),
    fetchScaleway(fx, signal),
  ]);
  return {
    hosting: dedupeHosting(results.flatMap((r) => r.hosting)),
    gpu: dedupeGpu(results.flatMap((r) => r.gpu)),
    statuses: results.map((r) => r.status),
    fx,
  };
}

// ---------------------------------------------------------------------------
// ranking helpers
// ---------------------------------------------------------------------------

import { freshnessScore, specFitScore, type Candidate } from "./score";

/**
 * Collapse the same plan offered in many zones into one row.
 *
 * Scaleway publishes a separate SKU per availability zone, so a single plan
 * arrives five times at an identical price. Listing them separately pushes
 * genuinely different options off the page and makes a five-way tie look like
 * five findings. Rows are grouped on provider + specs + price — never on name,
 * which embeds the zone — and the regions are merged so nothing is lost.
 *
 * Offers that differ in price by zone stay separate, because then they really
 * are different offers.
 */
export function dedupeHosting(offers: HostingOffer[]): HostingOffer[] {
  const groups = new Map<string, HostingOffer>();
  for (const o of offers) {
    const price = o.effectiveMonthlyUsd ?? o.monthlyUsd;
    const key = [o.providerSlug, o.vcpu, o.ramMB, o.diskGB, o.transferGB, price].join("|");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...o, regions: o.regions ? [...o.regions] : undefined });
      continue;
    }
    const merged = new Set([...(existing.regions ?? []), ...(o.regions ?? [])]);
    existing.regions = merged.size ? [...merged] : undefined;
  }
  return [...groups.values()];
}

/** Same idea for GPU offers, which Scaleway also lists per zone. */
export function dedupeGpu(offers: GpuOffer[]): GpuOffer[] {
  const groups = new Map<string, GpuOffer>();
  for (const o of offers) {
    const key = [o.providerSlug, o.gpuModel, o.gpuCount, o.vcpu, o.ramMB, o.hourlyUsd].join("|");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...o, regions: o.regions ? [...o.regions] : undefined });
      continue;
    }
    const merged = new Set([...(existing.regions ?? []), ...(o.regions ?? [])]);
    existing.regions = merged.size ? [...merged] : undefined;
  }
  return [...groups.values()];
}

export interface HostingQuery {
  text?: string;
  minVcpu?: number;
  minRamMB?: number;
  minDiskGB?: number;
  maxMonthlyUsd?: number;
  providers?: string[];
}

export function hostingMatches(offer: HostingOffer, q: HostingQuery): boolean {
  if (q.providers?.length && !q.providers.includes(offer.providerSlug)) return false;
  if (q.minVcpu && (offer.vcpu ?? 0) < q.minVcpu) return false;
  if (q.minRamMB && (offer.ramMB ?? 0) < q.minRamMB) return false;
  if (q.minDiskGB && (offer.diskGB ?? 0) < q.minDiskGB) return false;
  if (q.maxMonthlyUsd !== undefined) {
    const price = offer.effectiveMonthlyUsd ?? offer.monthlyUsd;
    if (price === undefined || price > q.maxMonthlyUsd) return false;
  }
  if (q.text?.trim()) {
    const needle = q.text.trim().toLowerCase();
    const hay = `${offer.name} ${offer.planKey} ${offer.providerName}`.toLowerCase();
    if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export interface HostingCandidate extends Candidate {
  offer: HostingOffer;
}

/**
 * Performance for a VPS is the resource bundle itself. vCPU is weighted above
 * RAM and disk because it is the axis most workloads run out of first, and the
 * figure is only ever used to *rank* candidates against each other — it is not
 * shown as a benchmark score, which would imply a measurement we have not made.
 */
export function hostingPerformance(offer: HostingOffer): number | undefined {
  const vcpu = offer.vcpu;
  const ramGB = offer.ramMB === undefined ? undefined : offer.ramMB / 1024;
  if (vcpu === undefined && ramGB === undefined) return undefined;
  return quantize((vcpu ?? 0) * 2 + (ramGB ?? 0) + (offer.diskGB ?? 0) / 40);
}

export function toHostingCandidate(offer: HostingOffer, q: HostingQuery = {}): HostingCandidate {
  const specFit = specFitScore(
    { vcpu: q.minVcpu, ram: q.minRamMB, disk: q.minDiskGB },
    { vcpu: offer.vcpu, ram: offer.ramMB, disk: offer.diskGB },
  );
  return {
    key: offer.planKey,
    providerSlug: offer.providerSlug,
    price: offer.effectiveMonthlyUsd ?? offer.monthlyUsd,
    performance: hostingPerformance(offer),
    reliability: quantize(0.6 * 0.9 + 0.4 * freshnessScore(offer.provenance.fetchedAt)),
    specFit,
    availability: "available",
    offer,
  };
}

export interface GpuQuery {
  text?: string;
  gpuModel?: string;
  minVramGB?: number;
  maxHourlyUsd?: number;
  providers?: string[];
}

export function gpuMatches(offer: GpuOffer, q: GpuQuery): boolean {
  if (q.providers?.length && !q.providers.includes(offer.providerSlug)) return false;
  if (q.minVramGB && (offer.vramGBPerGpu ?? 0) < q.minVramGB) return false;
  if (q.maxHourlyUsd !== undefined) {
    if (offer.hourlyUsd === undefined || offer.hourlyUsd > q.maxHourlyUsd) return false;
  }
  if (q.gpuModel && !(offer.gpuModel ?? "").toLowerCase().includes(q.gpuModel.toLowerCase())) {
    return false;
  }
  if (q.text?.trim()) {
    const needle = q.text.trim().toLowerCase();
    const hay = `${offer.name} ${offer.offerKey} ${offer.providerName} ${offer.gpuModel ?? ""}`.toLowerCase();
    if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export interface GpuCandidate extends Candidate {
  offer: GpuOffer;
}

export function toGpuCandidate(offer: GpuOffer): GpuCandidate {
  return {
    key: offer.offerKey,
    providerSlug: offer.providerSlug,
    price: offer.hourlyUsd ?? (offer.monthlyUsd === undefined ? undefined : offer.monthlyUsd / 730),
    performance:
      offer.vramGBPerGpu === undefined
        ? undefined
        : quantize(offer.vramGBPerGpu * (offer.gpuCount ?? 1)),
    reliability: quantize(0.6 * 0.9 + 0.4 * freshnessScore(offer.provenance.fetchedAt)),
    availability: offer.availability ?? "available",
    offer,
  };
}
