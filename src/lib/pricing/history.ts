/**
 * Local price history.
 *
 * Stored at `~/.harnessx/pricing/history.json`, append-only, never overwritten —
 * the same discipline the server-side original used, for the same reason: you
 * cannot backfill history, so it only accrues to whoever starts collecting
 * first.
 *
 * **The honest limitation.** This accrues from *your install date*, on *your
 * machine*. A shared corpus spanning every user would need a server collecting
 * on everyone's behalf, which this app deliberately does not have. So the first
 * run shows no history at all, and the feature gets more useful the longer the
 * app is used. The UI says this rather than showing an empty chart that looks
 * broken.
 *
 * Only *changes* are recorded. Prices are sticky — most models keep the same
 * price for months — so storing a point per refresh would grow the file by
 * ~6,000 entries a day to say "nothing happened". Recording transitions keeps
 * it small enough to stay plain JSON.
 */

import { blended, quantize } from "./money";
import type { PriceCatalog, PricedModel } from "./types";

const DIR = ".harnessx/pricing";
const FILE = `${DIR}/history.json`;

/** Keep at most this many points per entity; the oldest are dropped first. */
export const MAX_POINTS = 48;

/** [ISO timestamp, price]. */
export type Point = [string, number];

export interface PriceHistory {
  /** Entity id → observed price transitions, oldest first. */
  series: Record<string, Point[]>;
  /** When this file was last appended to. */
  updatedAt: string;
  /** First observation of any kind, so the UI can say how far back it goes. */
  startedAt: string;
}

export const EMPTY_HISTORY: PriceHistory = { series: {}, updatedAt: "", startedAt: "" };

async function fs() {
  return import("@tauri-apps/plugin-fs");
}

export async function loadHistory(): Promise<PriceHistory> {
  try {
    const { BaseDirectory, exists, readTextFile } = await fs();
    const opts = { baseDir: BaseDirectory.Home };
    if (!(await exists(FILE, opts))) return EMPTY_HISTORY;
    const parsed = JSON.parse(await readTextFile(FILE, opts)) as PriceHistory;
    if (!parsed || typeof parsed.series !== "object") return EMPTY_HISTORY;
    return { ...EMPTY_HISTORY, ...parsed };
  } catch {
    return EMPTY_HISTORY;
  }
}

export async function saveHistory(history: PriceHistory): Promise<void> {
  try {
    const { BaseDirectory, mkdir, writeTextFile } = await fs();
    const opts = { baseDir: BaseDirectory.Home };
    await mkdir(DIR, { ...opts, recursive: true });
    await writeTextFile(FILE, JSON.stringify(history), opts);
  } catch {
    // History is a bonus, not a correctness requirement. A machine where the
    // file cannot be written still gets live prices.
  }
}

/** The comparable price for a model: its blended per-Mtok rate. */
export function modelPrice(model: PricedModel): number | undefined {
  return blended(model.pricing.input, model.pricing.output);
}

/**
 * Fold a catalog into the history, recording only prices that changed.
 *
 * Pure: takes the previous history and returns a new one, so it is testable
 * without touching the filesystem.
 */
export function recordSnapshot(
  history: PriceHistory,
  catalog: PriceCatalog,
  now = new Date().toISOString(),
): PriceHistory {
  const series: Record<string, Point[]> = { ...history.series };

  const observe = (id: string, price: number | undefined) => {
    if (price === undefined) return;
    const rounded = quantize(price);
    const existing = series[id];
    if (!existing?.length) {
      series[id] = [[now, rounded]];
      return;
    }
    const last = existing[existing.length - 1];
    if (last[1] === rounded) return; // no change — nothing to record
    const next = [...existing, [now, rounded] as Point];
    series[id] = next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
  };

  for (const m of catalog.models) observe(m.id, modelPrice(m));
  for (const h of catalog.hosting) observe(h.id, h.effectiveMonthlyUsd ?? h.monthlyUsd);
  for (const g of catalog.gpu) observe(g.id, g.hourlyUsd);

  return {
    series,
    updatedAt: now,
    startedAt: history.startedAt || now,
  };
}

export type ChangeKind = "drop" | "rise" | "new";

export interface PriceChange {
  id: string;
  kind: ChangeKind;
  /** Price before the change; undefined for a first sighting. */
  from?: number;
  to: number;
  /** Signed percentage change; negative is a drop. */
  pct?: number;
  at: string;
}

/**
 * Changes observed since `since`, largest move first.
 *
 * A first sighting is reported as "new" rather than as a 100% drop — a model we
 * had not seen before did not get cheaper, we just weren't looking.
 */
export function changesSince(
  history: PriceHistory,
  since: number,
  opts: { minPct?: number; limit?: number } = {},
): PriceChange[] {
  const minPct = opts.minPct ?? 1;
  const out: PriceChange[] = [];

  for (const [id, points] of Object.entries(history.series)) {
    if (points.length === 0) continue;
    const last = points[points.length - 1];
    const at = Date.parse(last[0]);
    if (!Number.isFinite(at) || at < since) continue;

    if (points.length === 1) {
      out.push({ id, kind: "new", to: last[1], at: last[0] });
      continue;
    }
    const prev = points[points.length - 2];
    if (prev[1] === 0) {
      // A move away from free has no meaningful percentage.
      out.push({ id, kind: "rise", from: 0, to: last[1], at: last[0] });
      continue;
    }
    const pct = ((last[1] - prev[1]) / prev[1]) * 100;
    if (Math.abs(pct) < minPct) continue;
    out.push({
      id,
      kind: pct < 0 ? "drop" : "rise",
      from: prev[1],
      to: last[1],
      pct: Math.round(pct * 100) / 100,
      at: last[0],
    });
  }

  out.sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/** Series for one entity, for a sparkline. */
export function seriesFor(history: PriceHistory, id: string): Point[] {
  return history.series[id] ?? [];
}

/** How many days of observation this history represents. */
export function historyDays(history: PriceHistory): number {
  if (!history.startedAt) return 0;
  const start = Date.parse(history.startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}
