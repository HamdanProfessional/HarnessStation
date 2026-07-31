import type { Cadence } from "./types";

function atTimeToday(base: Date, hh: number, mm: number): Date {
  const d = new Date(base);
  d.setHours(hh, mm, 0, 0);
  return d;
}

function parseHHMM(time: string): [number, number] {
  const [h, m] = time.split(":").map((x) => parseInt(x, 10));
  return [Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0];
}

/** Next run timestamp (ms) for a cadence, strictly after `fromMs`. Null = never again. */
export function computeNextRun(cadence: Cadence, fromMs: number): number | null {
  const from = new Date(fromMs);
  switch (cadence.type) {
    case "interval":
      return fromMs + Math.max(1, cadence.minutes) * 60_000;
    case "hourly": {
      const d = new Date(from);
      d.setMinutes(cadence.minute, 0, 0);
      if (d.getTime() <= fromMs) d.setHours(d.getHours() + 1);
      return d.getTime();
    }
    case "daily": {
      const [hh, mm] = parseHHMM(cadence.time);
      let d = atTimeToday(from, hh, mm);
      if (d.getTime() <= fromMs) d = new Date(d.getTime() + 86_400_000);
      return d.getTime();
    }
    case "weekly": {
      const [hh, mm] = parseHHMM(cadence.time);
      const d = atTimeToday(from, hh, mm);
      let delta = (cadence.day - d.getDay() + 7) % 7;
      if (delta === 0 && d.getTime() <= fromMs) delta = 7;
      d.setDate(d.getDate() + delta);
      return d.getTime();
    }
    case "once": {
      const t = Date.parse(cadence.at);
      return Number.isFinite(t) && t > fromMs ? t : null;
    }
  }
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describeCadence(c: Cadence): string {
  switch (c.type) {
    case "interval":
      return `Every ${c.minutes} min`;
    case "hourly":
      return `Hourly at :${String(c.minute).padStart(2, "0")}`;
    case "daily":
      return `Daily at ${c.time}`;
    case "weekly":
      return `${DAYS[c.day]} at ${c.time}`;
    case "once":
      return `Once at ${new Date(c.at).toLocaleString()}`;
  }
}

export function formatWhen(ms?: number): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const now = Date.now();
  const diff = ms - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const rel =
    mins < 1 ? "now" : mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return `${d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} (${diff >= 0 ? "in " : ""}${rel}${diff < 0 ? " ago" : ""})`;
}
