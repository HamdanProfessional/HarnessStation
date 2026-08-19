/**
 * Currency normalization.
 *
 * Several European providers quote in EUR. Comparing a EUR price to a USD one
 * without a rate is silently wrong — and using *today's* rate to explain a price
 * recorded last month is wrong in a subtler way, because the comparison can no
 * longer be reproduced. So every converted figure carries the rate and the date
 * it was taken from, and the history log stores the converted USD value rather
 * than re-converting on read.
 *
 * Source: the European Central Bank's daily reference rates via Frankfurter,
 * which is public and needs no key. It sends no CORS headers, so in the browser
 * build the fetch fails and the pinned fallback below is used instead — with
 * `stale: true` set, so the UI can say the conversion is approximate rather than
 * quietly presenting an old rate as current.
 */

import { fetch } from "@tauri-apps/plugin-http";
import { quantize } from "./money";

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD";
const CACHE_KEY = "hs-fx-v1";

/**
 * Pinned fallback, used only when the live rate cannot be fetched.
 *
 * A wrong-by-a-few-percent conversion clearly labelled as approximate is more
 * useful than refusing to show European providers at all; a wrong conversion
 * presented as exact would not be.
 */
export const FALLBACK_EUR_USD = { rate: 1.1567, date: "2026-08-14" };

export interface FxRate {
  /** Multiply EUR by this to get USD. */
  eurUsd: number;
  /** The date the rate is quoted for (ECB reference date). */
  date: string;
  /** True when this is the pinned fallback rather than a live quote. */
  stale: boolean;
}

let cached: FxRate | null = null;

function readCache(): FxRate | null {
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (raw && typeof raw.eurUsd === "number" && raw.eurUsd > 0) {
      cached = raw as FxRate;
      return cached;
    }
  } catch {
    /* no cache */
  }
  return null;
}

/** Fetch the current EUR→USD rate, falling back to the cache then the pin. */
export async function fetchFxRate(signal?: AbortSignal): Promise<FxRate> {
  try {
    const res = await fetch(FX_URL, { headers: { "User-Agent": "HarnessStation" }, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { date?: string; rates?: { USD?: number } };
    const rate = body?.rates?.USD;
    if (typeof rate !== "number" || !(rate > 0)) throw new Error("no USD rate in response");
    const fx: FxRate = { eurUsd: rate, date: body.date ?? "", stale: false };
    cached = fx;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(fx));
    } catch {
      /* cache is an optimization */
    }
    return fx;
  } catch {
    const prior = readCache();
    if (prior) return { ...prior, stale: true };
    return { eurUsd: FALLBACK_EUR_USD.rate, date: FALLBACK_EUR_USD.date, stale: true };
  }
}

/** Synchronous rate for code that cannot await — cache, then pin. */
export function currentFxRate(): FxRate {
  return (
    readCache() ?? { eurUsd: FALLBACK_EUR_USD.rate, date: FALLBACK_EUR_USD.date, stale: true }
  );
}

/** Convert an amount in `currency` to USD. Unknown currencies return undefined. */
export function toUsd(
  amount: number | undefined,
  currency: string | undefined,
  fx: FxRate,
): number | undefined {
  if (amount === undefined) return undefined;
  const code = (currency ?? "USD").toUpperCase();
  if (code === "USD") return quantize(amount);
  if (code === "EUR") return quantize(amount * fx.eurUsd);
  // A currency we have no rate for is not something we may guess at.
  return undefined;
}
