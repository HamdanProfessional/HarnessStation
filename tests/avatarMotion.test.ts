import { describe, expect, it } from "vitest";
import { createMotionDriver, speechEnvelope, MMD_MORPHS } from "../src/lib/avatarMotion";

/** Deterministic "random" so blink timing is reproducible. */
const fixed = (v = 0.5) => () => v;

const run = (
  driver: ReturnType<typeof createMotionDriver>,
  state: Parameters<ReturnType<typeof createMotionDriver>["update"]>[1],
  seconds: number,
  level = 0,
  dt = 1 / 60,
) => {
  let last = driver.update(dt, state, level);
  for (let t = dt; t < seconds; t += dt) last = driver.update(dt, state, level);
  return last;
};

describe("speechEnvelope", () => {
  it("stays within the mouth's range", () => {
    for (let t = 0; t < 20; t += 0.013) {
      const v = speechEnvelope(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("actually closes the mouth sometimes, rather than hovering open", () => {
    const samples = Array.from({ length: 2000 }, (_, i) => speechEnvelope(i * 0.013));
    expect(Math.min(...samples)).toBeLessThan(0.25);
    expect(Math.max(...samples)).toBeGreaterThan(0.7);
  });

  it("is deterministic", () => {
    expect(speechEnvelope(3.21)).toBe(speechEnvelope(3.21));
  });
});

describe("mouth", () => {
  it("stays shut when idle", () => {
    expect(run(createMotionDriver(fixed()), "idle", 2).mouth).toBeCloseTo(0, 2);
  });

  it("moves while speaking", () => {
    const d = createMotionDriver(fixed());
    const seen: number[] = [];
    for (let t = 0; t < 3; t += 1 / 60) seen.push(d.update(1 / 60, "speaking", 0).mouth);
    expect(Math.max(...seen)).toBeGreaterThan(0.2);
    expect(Math.min(...seen)).toBeLessThan(0.1);
  });

  it("follows the mic while listening, and ignores it otherwise", () => {
    expect(run(createMotionDriver(fixed()), "listening", 1, 1).mouth).toBeGreaterThan(0.2);
    expect(run(createMotionDriver(fixed()), "listening", 1, 0).mouth).toBeCloseTo(0, 2);
    // A loud room shouldn't flap the mouth while the avatar is thinking.
    expect(run(createMotionDriver(fixed()), "thinking", 1, 1).mouth).toBeCloseTo(0, 2);
  });

  it("opens faster than it closes", () => {
    const open = createMotionDriver(fixed());
    let v = 0;
    for (let i = 0; i < 6; i++) v = open.update(1 / 60, "listening", 1).mouth;
    const rise = v;
    let w = v;
    for (let i = 0; i < 6; i++) w = open.update(1 / 60, "idle", 0).mouth;
    expect(rise).toBeGreaterThan(v - w); // fell less in the same number of frames
  });
});

describe("blink", () => {
  it("closes and reopens rather than staying shut", () => {
    const d = createMotionDriver(fixed(0));
    const seen: number[] = [];
    for (let t = 0; t < 6; t += 1 / 60) seen.push(d.update(1 / 60, "idle", 0).blink);
    expect(Math.max(...seen)).toBeGreaterThan(0.8);
    expect(seen[seen.length - 1]).toBeCloseTo(0, 1);
  });

  it("blinks more than once over a long idle", () => {
    const d = createMotionDriver(fixed(0));
    let blinks = 0;
    let was = 0;
    for (let t = 0; t < 30; t += 1 / 60) {
      const v = d.update(1 / 60, "idle", 0).blink;
      if (v > 0.5 && was <= 0.5) blinks++;
      was = v;
    }
    expect(blinks).toBeGreaterThan(3);
  });

  it("stays in range", () => {
    const d = createMotionDriver(fixed(0));
    for (let t = 0; t < 20; t += 1 / 60) {
      const v = d.update(1 / 60, "idle", 0).blink;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("expression and posture", () => {
  it("smiles most while speaking, not at all when idle", () => {
    const speaking = run(createMotionDriver(fixed()), "speaking", 3).happy;
    const listening = run(createMotionDriver(fixed()), "listening", 3).happy;
    const idle = run(createMotionDriver(fixed()), "idle", 3).happy;
    expect(speaking).toBeGreaterThan(listening);
    expect(listening).toBeGreaterThan(idle);
    expect(idle).toBeCloseTo(0, 2);
  });

  it("glances up while thinking", () => {
    const thinking = run(createMotionDriver(fixed()), "thinking", 0.5).headX;
    const idle = run(createMotionDriver(fixed()), "idle", 0.5).headX;
    expect(thinking).toBeLessThan(idle); // negative X pitches the head up
  });

  it("tilts while listening", () => {
    expect(run(createMotionDriver(fixed()), "listening", 0.5).headZ).toBeGreaterThan(
      run(createMotionDriver(fixed()), "idle", 0.5).headZ,
    );
  });

  it("keeps drifting so the model never looks frozen", () => {
    const d = createMotionDriver(fixed());
    const a = run(d, "idle", 1).headY;
    const b = run(d, "idle", 2).headY;
    expect(a).not.toBe(b);
  });

  it("keeps head motion small enough to look natural", () => {
    const d = createMotionDriver(fixed());
    for (let t = 0; t < 10; t += 1 / 60) {
      const f = d.update(1 / 60, "thinking", 0);
      for (const v of [f.headX, f.headY, f.headZ]) expect(Math.abs(v)).toBeLessThan(0.25);
      expect(Math.abs(f.breath)).toBeLessThan(0.05);
    }
  });
});

describe("MMD morph names", () => {
  it("tries the Japanese standard name first, then English", () => {
    // MMD models are overwhelmingly Japanese-named; the English aliases are for
    // models made outside that convention.
    expect(MMD_MORPHS.mouth[0]).toBe("あ");
    expect(MMD_MORPHS.blink[0]).toBe("まばたき");
    expect(MMD_MORPHS.happy[0]).toBe("笑い");
    for (const list of Object.values(MMD_MORPHS)) {
      expect(list.some((n) => /^[a-z]+$/i.test(n))).toBe(true);
    }
  });
});
