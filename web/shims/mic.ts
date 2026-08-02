/**
 * Microphone capture for the web build.
 *
 * The desktop app captures audio natively with cpal and hands back a WAV path
 * under ~/.harnessx. This does the same job with getUserMedia and the Web Audio
 * API, and — crucially — keeps the exact same contract: a recording is written
 * to `tmp/dictation.wav` in the browser filesystem (OPFS), and the caller gets
 * that path back. So the app's voice flow, which records then transcribes a
 * file, runs unchanged.
 *
 * Registered into the invoke() dispatcher, so `invoke("mic_start")` and friends
 * resolve here instead of reaching Rust.
 */

import { registerCommand } from "./core";
import { writeWav } from "./wav";
import { writeFile, mkdir } from "./fs";

/** Whisper wants 16 kHz mono, so we resample to that on the way out. */
const TARGET_RATE = 16000;
const WAV_PATH = "tmp/dictation.wav";

interface Session {
  ctx: AudioContext;
  stream: MediaStream;
  node: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
  /** Everything captured since the session started, at the context's rate. */
  samples: number[];
  rate: number;
  /** Recent RMS, for the level meter. */
  level: number;
}

let session: Session | null = null;

async function start(args: { device?: string | null } = {}): Promise<null> {
  await stop(); // a stale session (view switch, aborted turn) is simply replaced

  const constraints: MediaStreamConstraints = {
    audio: args.device
      ? { deviceId: { ideal: args.device } }
      : // Echo cancellation and noise suppression make speech recognition better,
        // not worse, so leave them on unless a specific device was asked for.
        { echoCancellation: true, noiseSuppression: true },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessorNode is deprecated in favour of AudioWorklet, but it needs no
  // separate module file and is universally supported — the right trade for a
  // capture buffer that just accumulates samples.
  const node = ctx.createScriptProcessor(4096, 1, 1);

  const s: Session = { ctx, stream, node, source, samples: [], rate: ctx.sampleRate, level: 0 };

  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      s.samples.push(input[i]);
      sum += input[i] * input[i];
    }
    s.level = Math.sqrt(sum / input.length);
  };

  source.connect(node);
  // A ScriptProcessorNode only fires while connected to the graph; routing it to
  // a zero-gain node keeps it running without anything being audible.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(ctx.destination);

  session = s;
  return null;
}

/** Linear resample to 16 kHz — good enough for speech, and what Whisper expects. */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, samples.length - 1);
    out[i] = samples[lo] + (samples[hi] - samples[lo]) * (src - lo);
  }
  return out;
}

async function writeSegment(samples: number[], rate: number): Promise<string> {
  const pcm = resample(Float32Array.from(samples), rate, TARGET_RATE);
  await mkdir("tmp");
  await writeFile(WAV_PATH, writeWav(pcm, TARGET_RATE));
  return WAV_PATH;
}

/** Write everything captured so far, and stop. */
async function stopAndWrite(): Promise<string> {
  if (!session) throw new Error("not recording");
  const { samples, rate } = session;
  await stop();
  return writeSegment(samples, rate);
}

/** Write everything so far and KEEP recording (clears the buffer). */
async function take(): Promise<string> {
  if (!session) throw new Error("not recording");
  const captured = session.samples;
  session.samples = [];
  return writeSegment(captured, session.rate);
}

/** Copy the audio so far WITHOUT consuming it (for rolling live transcription). */
async function snapshot(): Promise<string> {
  if (!session) throw new Error("not recording");
  return writeSegment(session.samples.slice(), session.rate);
}

async function stop(): Promise<void> {
  if (!session) return;
  const { node, source, stream, ctx } = session;
  try {
    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
  } catch {
    /* already torn down */
  }
  session = null;
}

async function devices(): Promise<string[]> {
  try {
    // Labels are only populated once permission has been granted, so this is
    // most useful after a recording has started at least once.
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "audioinput").map((d) => d.label || d.deviceId);
  } catch {
    return [];
  }
}

registerCommand("mic_start", (args) => start((args ?? {}) as { device?: string | null }));
registerCommand("mic_stop", () => stopAndWrite());
registerCommand("mic_take", () => take());
registerCommand("mic_snapshot", () => snapshot());
registerCommand("mic_level", () => session?.level ?? 0);
registerCommand("mic_devices", () => devices());
