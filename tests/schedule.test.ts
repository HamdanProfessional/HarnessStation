import { describe, expect, it } from "vitest";
import { computeNextRun, describeCadence } from "../src/lib/schedule";

/** Local-time helper so the expectations don't depend on the machine's zone. */
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

describe("computeNextRun", () => {
  it("adds the interval", () => {
    const from = at(2026, 7, 31, 12, 0);
    expect(computeNextRun({ type: "interval", minutes: 15 }, from)).toBe(from + 15 * 60_000);
  });

  it("clamps a zero/negative interval to one minute", () => {
    const from = at(2026, 7, 31, 12, 0);
    expect(computeNextRun({ type: "interval", minutes: 0 }, from)).toBe(from + 60_000);
    expect(computeNextRun({ type: "interval", minutes: -5 }, from)).toBe(from + 60_000);
  });

  it("hourly picks this hour when the minute is still ahead", () => {
    expect(computeNextRun({ type: "hourly", minute: 30 }, at(2026, 7, 31, 12, 10))).toBe(at(2026, 7, 31, 12, 30));
  });

  it("hourly rolls to the next hour once the minute has passed", () => {
    expect(computeNextRun({ type: "hourly", minute: 30 }, at(2026, 7, 31, 12, 45))).toBe(at(2026, 7, 31, 13, 30));
  });

  it("hourly rolls forward when it lands exactly on now", () => {
    expect(computeNextRun({ type: "hourly", minute: 30 }, at(2026, 7, 31, 12, 30))).toBe(at(2026, 7, 31, 13, 30));
  });

  it("daily picks today when the time is ahead, tomorrow otherwise", () => {
    expect(computeNextRun({ type: "daily", time: "09:00" }, at(2026, 7, 31, 7, 0))).toBe(at(2026, 7, 31, 9, 0));
    expect(computeNextRun({ type: "daily", time: "09:00" }, at(2026, 7, 31, 10, 0))).toBe(at(2026, 8, 1, 9, 0));
  });

  it("daily falls back to 09:00 for an unparseable time", () => {
    expect(computeNextRun({ type: "daily", time: "nonsense" }, at(2026, 7, 31, 7, 0))).toBe(at(2026, 7, 31, 9, 0));
  });

  it("weekly finds the next matching weekday", () => {
    // 2026-07-31 is a Friday (day 5).
    const friday = at(2026, 7, 31, 8, 0);
    expect(new Date(friday).getDay()).toBe(5);
    // Next Monday (day 1) at 09:00 -> 2026-08-03.
    expect(computeNextRun({ type: "weekly", day: 1, time: "09:00" }, friday)).toBe(at(2026, 8, 3, 9, 0));
  });

  it("weekly stays today when today matches and the time is still ahead", () => {
    expect(computeNextRun({ type: "weekly", day: 5, time: "18:00" }, at(2026, 7, 31, 8, 0))).toBe(
      at(2026, 7, 31, 18, 0),
    );
  });

  it("weekly jumps a full week when today matches but the time has passed", () => {
    expect(computeNextRun({ type: "weekly", day: 5, time: "06:00" }, at(2026, 7, 31, 8, 0))).toBe(
      at(2026, 8, 7, 6, 0),
    );
  });

  it("once returns the timestamp only while it is in the future", () => {
    const target = new Date(at(2026, 7, 31, 15, 0)).toISOString();
    expect(computeNextRun({ type: "once", at: target }, at(2026, 7, 31, 12, 0))).toBe(at(2026, 7, 31, 15, 0));
    expect(computeNextRun({ type: "once", at: target }, at(2026, 7, 31, 16, 0))).toBeNull();
    expect(computeNextRun({ type: "once", at: "not a date" }, at(2026, 7, 31, 12, 0))).toBeNull();
  });

  it("never returns a time at or before `from`", () => {
    const from = at(2026, 7, 31, 12, 0);
    const cadences = [
      { type: "interval", minutes: 5 },
      { type: "hourly", minute: 0 },
      { type: "daily", time: "12:00" },
      { type: "weekly", day: 5, time: "12:00" },
    ] as const;
    for (const c of cadences) expect(computeNextRun(c, from)!).toBeGreaterThan(from);
  });
});

describe("describeCadence", () => {
  it("pads the hourly minute", () => {
    expect(describeCadence({ type: "hourly", minute: 5 })).toBe("Hourly at :05");
  });

  it("names the weekday", () => {
    expect(describeCadence({ type: "weekly", day: 1, time: "09:00" })).toBe("Mon at 09:00");
  });

  it("describes intervals and daily runs", () => {
    expect(describeCadence({ type: "interval", minutes: 15 })).toBe("Every 15 min");
    expect(describeCadence({ type: "daily", time: "07:30" })).toBe("Daily at 07:30");
  });
});
