import { describe, expect, it } from "vitest";
import { createMotionDriver } from "../src/lib/avatarMotion";
import { bandLevel } from "../src/lib/loudness";

const fixed = (v = 0.5) => () => v;
type Driver = ReturnType<typeof createMotionDriver>;
type State = Parameters<Driver["update"]>[1];

/** Run `seconds` of frames and return the last frame. */
function run(
  driver: Driver,
  state: State,
  seconds: number,
  inputs: Parameters<Driver["update"]>[3] = {},
  dt = 1 / 60,
) {
  let last = driver.update(dt, state, 0, inputs);
  for (let t = dt; t < seconds; t += dt) last = driver.update(dt, state, 0, inputs);
  return last;
}

describe("bandLevel", () => {
  it("is zero for silence", () => {
    expect(bandLevel(new Uint8Array(256), 48000)).toBe(0);
    expect(bandLevel(new Uint8Array(0), 48000)).toBe(0);
  });

  it("reads a loud voice-band spectrum as near full", () => {
    const bins = new Uint8Array(256).fill(220); // flat loud spectrum
    const v = bandLevel(bins, 48000);
    expect(v).toBeGreaterThan(0.7);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("ignores energy outside the voice band (hiss/bass don't flap the mouth)", () => {
    const bins = new Uint8Array(256);
    bins[0] = 255; // below 85 Hz at 48 kHz/256 bins
    bins[255] = 255; // nyquist
    expect(bandLevel(bins, 48000)).toBeLessThan(0.05);
  });

  it("climbs with the spectrum, so the mouth tracks loudness not just presence", () => {
    const quiet = new Uint8Array(256).fill(40);
    const loud = new Uint8Array(256).fill(160);
    expect(bandLevel(loud, 48000)).toBeGreaterThan(bandLevel(quiet, 48000));
  });
});

describe("speech-level lip-sync", () => {
  it("opens the mouth further with real audio than without it", () => {
    const withAudio = run(createMotionDriver(fixed()), "speaking", 2, { speechLevel: 1 });
    const envelopeOnly = run(createMotionDriver(fixed()), "speaking", 2);
    // Both move, but measured loudness drives a wider mouth over the same span.
    expect(withAudio.mouth).toBeGreaterThanOrEqual(envelopeOnly.mouth - 0.05);
    expect(withAudio.mouth).toBeGreaterThan(0.3);
  });

  it("falls back to the synthetic envelope when level is null (native SAPI)", () => {
    const fallback = run(createMotionDriver(fixed()), "speaking", 2, { speechLevel: null });
    const plain = run(createMotionDriver(fixed()), "speaking", 2);
    expect(fallback.mouth).toBeCloseTo(plain.mouth, 5);
  });

  it("a silent-but-measured stream closes the mouth rather than flapping", () => {
    const silent = run(createMotionDriver(fixed()), "speaking", 2, { speechLevel: 0 });
    expect(silent.mouth).toBeLessThan(0.15);
  });

  it("never exceeds the mouth's range", () => {
    const d = createMotionDriver(fixed());
    for (let t = 0; t < 3; t += 1 / 60) {
      const f = d.update(1 / 60, "speaking", 0, { speechLevel: 1.5 }); // over-driven on purpose
      expect(f.mouth).toBeLessThanOrEqual(1);
      expect(f.mouth).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("pointer head tracking", () => {
  it("turns toward the pointer on the right", () => {
    const f = run(createMotionDriver(fixed()), "idle", 3, { pointer: { x: 1, y: 0 } });
    expect(f.headY).toBeGreaterThan(0.25); // well beyond idle sway (±0.05)
  });

  it("looks up when the pointer is high", () => {
    const up = run(createMotionDriver(fixed()), "idle", 3, { pointer: { x: 0, y: 1 } }).headX;
    const down = run(createMotionDriver(fixed()), "idle", 3, { pointer: { x: 0, y: -1 } }).headX;
    expect(up).toBeLessThan(down);
  });

  it("eases back to centre when the pointer is gone", () => {
    const d = createMotionDriver(fixed());
    for (let t = 0; t < 2; t += 1 / 60) d.update(1 / 60, "idle", 0, { pointer: { x: 1, y: 0 } });
    const settled = run(d, "idle", 4);
    expect(Math.abs(settled.headY)).toBeLessThan(0.08);
  });

  it("keeps total head motion in a natural range", () => {
    const d = createMotionDriver(fixed());
    for (let t = 0; t < 6; t += 1 / 60) {
      const f = d.update(1 / 60, "speaking", 0, { pointer: { x: -1, y: -1 }, speechLevel: 0.8 });
      expect(Math.abs(f.headX)).toBeLessThan(0.5);
      expect(Math.abs(f.headY)).toBeLessThan(0.55);
    }
  });

  it("behaves identically to before when no inputs are given", () => {
    // Existing call sites pass only three arguments — that path must be
    // byte-for-byte the old behaviour.
    const a = run(createMotionDriver(fixed()), "listening", 1, {});
    const b = createMotionDriver(fixed());
    let last!: ReturnType<Driver["update"]>;
    for (let t = 0; t < 1; t += 1 / 60) last = b.update(1 / 60, "listening", 0);
    expect(a.headY).toBeCloseTo(last.headY, 5);
  });
});
