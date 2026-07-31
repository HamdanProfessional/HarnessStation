/**
 * Spend tracking and hard caps.
 *
 * The tool loop can run 60 rounds unattended, and swarm_spawn multiplies that by
 * the number of helpers. Without a ceiling, one bad prompt can quietly burn a lot
 * of credit. This keeps a running ledger per day/provider/model and refuses to
 * start another request once the cap is hit.
 */
import { invoke } from "@tauri-apps/api/core";
import { messageCost } from "./cost";

const LEDGER_KEY = "hs-spend-v1";

export interface SpendRow {
  /** YYYY-MM-DD, local time. */
  day: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  usd: number;
  calls: number;
}

interface Ledger {
  rows: SpendRow[];
  /** Spend the pricing table couldn't value, so totals aren't silently wrong. */
  unpricedCalls: number;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function load(): Ledger {
  try {
    const raw = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "null");
    if (raw && Array.isArray(raw.rows)) return { rows: raw.rows, unpricedCalls: raw.unpricedCalls ?? 0 };
  } catch {
    /* corrupt or absent */
  }
  return { rows: [], unpricedCalls: 0 };
}

function save(l: Ledger): void {
  // Keep 90 days; beyond that it's noise and localStorage isn't a database.
  const cutoff = new Date(Date.now() - 90 * 86_400_000);
  const min = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  l.rows = l.rows.filter((r) => r.day >= min);
  localStorage.setItem(LEDGER_KEY, JSON.stringify(l));
}

/** Subscribers so the UI can live-update without polling. */
const listeners = new Set<() => void>();
export function onSpendChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Record one completed request. Cost is estimated; unpriced models are counted separately. */
export function recordUsage(
  providerId: string,
  model: string,
  promptTokens = 0,
  completionTokens = 0,
): void {
  if (!promptTokens && !completionTokens) return;
  const l = load();
  const day = today();
  const usd = messageCost(model, promptTokens, completionTokens);
  if (usd === null) l.unpricedCalls++;
  let row = l.rows.find((r) => r.day === day && r.providerId === providerId && r.model === model);
  if (!row) {
    row = { day, providerId, model, promptTokens: 0, completionTokens: 0, usd: 0, calls: 0 };
    l.rows.push(row);
  }
  row.promptTokens += promptTokens;
  row.completionTokens += completionTokens;
  row.usd += usd ?? 0;
  row.calls++;
  save(l);
  for (const fn of listeners) fn();
}

export interface SpendTotals {
  todayUsd: number;
  monthUsd: number;
  allUsd: number;
  todayTokens: number;
  unpricedCalls: number;
  byModel: { model: string; usd: number; tokens: number; calls: number }[];
}

export function totals(): SpendTotals {
  const l = load();
  const day = today();
  const month = day.slice(0, 7);
  const byModel = new Map<string, { usd: number; tokens: number; calls: number }>();
  let todayUsd = 0;
  let monthUsd = 0;
  let allUsd = 0;
  let todayTokens = 0;
  for (const r of l.rows) {
    const tok = r.promptTokens + r.completionTokens;
    allUsd += r.usd;
    if (r.day.startsWith(month)) monthUsd += r.usd;
    if (r.day === day) {
      todayUsd += r.usd;
      todayTokens += tok;
    }
    const cur = byModel.get(r.model) ?? { usd: 0, tokens: 0, calls: 0 };
    cur.usd += r.usd;
    cur.tokens += tok;
    cur.calls += r.calls;
    byModel.set(r.model, cur);
  }
  return {
    todayUsd,
    monthUsd,
    allUsd,
    todayTokens,
    unpricedCalls: l.unpricedCalls,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.usd - a.usd),
  };
}

export function resetSpend(): void {
  localStorage.removeItem(LEDGER_KEY);
  for (const fn of listeners) fn();
}

/**
 * Check the caps before starting a request. Returns a reason string when the
 * request must not run, or null when it's fine.
 *
 * Caps apply to *estimated* spend, so a model with no pricing data can't be
 * capped — that's called out in the UI rather than silently ignored.
 */
export function capExceeded(dailyCap?: number, monthlyCap?: number): string | null {
  if (!dailyCap && !monthlyCap) return null;
  const t = totals();
  if (dailyCap && t.todayUsd >= dailyCap) {
    return `Daily spend cap reached (${t.todayUsd.toFixed(2)} of $${dailyCap.toFixed(2)}). Raise or clear it in Settings → Spend.`;
  }
  if (monthlyCap && t.monthUsd >= monthlyCap) {
    return `Monthly spend cap reached (${t.monthUsd.toFixed(2)} of $${monthlyCap.toFixed(2)}). Raise or clear it in Settings → Spend.`;
  }
  return null;
}

/** Push today's spend into the tray tooltip so it's visible while minimised. */
export async function syncTray(extra = ""): Promise<void> {
  const t = totals();
  const spend = t.todayUsd > 0 ? `$${t.todayUsd.toFixed(2)} today` : "";
  const text = [extra, spend].filter(Boolean).join(" · ");
  try {
    await invoke("set_tray_title", { text });
  } catch {
    /* tray unavailable */
  }
}
