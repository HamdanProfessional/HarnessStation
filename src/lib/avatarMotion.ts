import type { VoiceState } from "./voice";

/**
 * The avatar's per-frame motion, independent of how it's rendered.
 *
 * VRM and MMD have completely different rigs and morph naming, but the *motion*
 * is the same idea in both: a mouth that opens with speech, eyes that blink, an
 * expression that follows the session state, and enough idle drift that the
 * character never looks frozen. Keeping it here means one implementation, and
 * one that can be tested without a GPU.
 */

export interface MotionFrame {
  /** 0..1 mouth openness. */
  mouth: number;
  /** 0..1 eyelid closure. */
  blink: number;
  /** 0..1 smile. */
  happy: number;
  /** Head rotation in radians. */
  headX: number;
  headY: number;
  headZ: number;
  /** Small vertical breathing offset, in model units. */
  breath: number;
}

/** Smooth, non-repeating jaw movement for speech we have no viseme data for. */
export function speechEnvelope(t: number): number {
  const a = Math.sin(t * 11.3) * 0.5 + 0.5;
  const b = Math.sin(t * 6.7 + 1.7) * 0.5 + 0.5;
  const c = Math.sin(t * 19.1 + 0.4) * 0.5 + 0.5;
  // Multiplying decorrelated waves gives syllable-like bursts with real closures.
  return Math.min(1, a * 0.6 + b * 0.5 * c);
}

export interface MotionDriver {
  /** Advance by `dt` seconds and return what the rig should be set to. */
  update(dt: number, state: VoiceState, micLevel: number): MotionFrame;
}

/**
 * `random` is injectable so tests get deterministic blink timing.
 */
export function createMotionDriver(random: () => number = Math.random): MotionDriver {
  let mouth = 0;
  let blinkPhase = 0; // 1 -> 0 across a blink
  let nextBlink = 1 + random() * 3;
  let happy = 0;
  let elapsed = 0;

  return {
    update(dt, state, micLevel) {
      elapsed += dt;

      // Listening shows the user's own level; speaking uses a synthetic envelope,
      // because none of the speech engines give us visemes.
      const target =
        state === "speaking"
          ? speechEnvelope(elapsed) * 0.75
          : state === "listening"
            ? Math.min(1, micLevel * 7) * 0.35
            : 0;
      // Asymmetric smoothing: mouths open faster than they close.
      mouth += (target - mouth) * Math.min(1, dt * (target > mouth ? 22 : 12));

      nextBlink -= dt;
      if (nextBlink <= 0 && blinkPhase <= 0) {
        blinkPhase = 1;
        nextBlink = 1.6 + random() * 4;
      }
      let blink = 0;
      if (blinkPhase > 0) {
        blinkPhase = Math.max(0, blinkPhase - dt * 7.5);
        // A blink is a quick down-up, not a linear fade.
        blink = Math.sin(Math.min(1, 1 - blinkPhase) * Math.PI);
      }

      const happyTarget = state === "speaking" ? 0.35 : state === "listening" ? 0.15 : 0;
      happy += (happyTarget - happy) * Math.min(1, dt * 3);

      const think = state === "thinking" ? 1 : 0;
      return {
        mouth,
        blink,
        happy,
        // Attentive tilt while listening, a glance up while thinking.
        headX: Math.sin(elapsed * 0.7) * 0.02 - think * 0.09,
        headY: Math.sin(elapsed * 0.45) * 0.05 + think * 0.12,
        headZ: Math.sin(elapsed * 0.33) * 0.02 + (state === "listening" ? 0.05 : 0),
        breath: Math.sin(elapsed * 1.15) * 0.012,
      };
    },
  };
}

/**
 * MMD morph names are Japanese by convention (the VOCALOID/MMD standard set).
 * Models from outside Japan sometimes use English, so both are tried in order
 * and the first name the model actually has wins.
 */
export const MMD_MORPHS = {
  mouth: ["あ", "a", "A", "aa"],
  blink: ["まばたき", "まばたき2", "blink", "Blink"],
  happy: ["笑い", "にこり", "smile", "Smile", "happy"],
} as const;
