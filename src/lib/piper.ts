import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, exists, readFile, remove, stat } from "@tauri-apps/plugin-fs";
import { downloadFile, extractZip } from "./local";
import { isLinux } from "./platform";

/**
 * Piper — offline neural text-to-speech. Much more natural than the built-in
 * Windows SAPI voices, still fully local and free. Engine + voices download on first use.
 */

const opts = { baseDir: BaseDirectory.Home };
const ENGINE_DIR = "piper/engine";
const RELEASE = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2";

/** Engine archive for this platform. Linux ships a .tar.gz, Windows a .zip. */
function engineAsset(): { file: string; url: string } {
  const name = isLinux() ? "piper_linux_x86_64.tar.gz" : "piper_windows_amd64.zip";
  return { file: `piper/${name}`, url: `${RELEASE}/${name}` };
}
const VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

export interface PiperVoice {
  id: string; // file stem, e.g. en_US-amy-medium
  label: string;
  path: string; // path under the HF repo
  mb: number;
}

/** A small curated set — all verified to exist upstream. */
export const PIPER_VOICES: PiperVoice[] = [
  { id: "en_US-amy-medium", label: "Amy — US female, warm", path: "en/en_US/amy/medium", mb: 61 },
  { id: "en_US-lessac-medium", label: "Lessac — US female, clear", path: "en/en_US/lessac/medium", mb: 61 },
  { id: "en_US-kristin-medium", label: "Kristin — US female, bright", path: "en/en_US/kristin/medium", mb: 61 },
  { id: "en_US-ryan-high", label: "Ryan — US male, high quality", path: "en/en_US/ryan/high", mb: 114 },
  { id: "en_US-joe-medium", label: "Joe — US male, relaxed", path: "en/en_US/joe/medium", mb: 61 },
  { id: "en_GB-alba-medium", label: "Alba — UK female, Scottish", path: "en/en_GB/alba/medium", mb: 61 },
  {
    id: "en_GB-northern_english_male-medium",
    label: "Northern — UK male",
    path: "en/en_GB/northern_english_male/medium",
    mb: 61,
  },
  { id: "en_US-kathleen-low", label: "Kathleen — US female, fastest", path: "en/en_US/kathleen/low", mb: 21 },
];

export const DEFAULT_PIPER_VOICE = "en_US-amy-medium";

export function piperVoice(id: string): PiperVoice {
  return PIPER_VOICES.find((v) => v.id === id) ?? PIPER_VOICES[0];
}

const modelRel = (v: PiperVoice) => `piper/voices/${v.id}.onnx`;
const configRel = (v: PiperVoice) => `piper/voices/${v.id}.onnx.json`;

async function sizeOk(rel: string, minBytes: number): Promise<boolean> {
  try {
    if (!(await exists(`.harnessx/${rel}`, opts))) return false;
    const s = await stat(`.harnessx/${rel}`, opts);
    return (s.size ?? 0) >= minBytes;
  } catch {
    return false;
  }
}

/** Download the Piper engine and the chosen voice if they aren't ready yet. */
export async function ensurePiper(
  onStatus: (s: string) => void,
  voiceId: string = DEFAULT_PIPER_VOICE,
): Promise<void> {
  if (!(await exists(`.harnessx/${ENGINE_DIR}`, opts))) {
    const asset = engineAsset();
    onStatus("Downloading neural voice engine (one-time, ~20 MB)...");
    await downloadFile(asset.url, asset.file, "piper-engine");
    onStatus("Extracting voice engine...");
    await extractZip(asset.file, ENGINE_DIR);
  }
  const v = piperVoice(voiceId);
  const model = modelRel(v);
  // A truncated model can't load — re-fetch instead of failing forever.
  if (!(await sizeOk(model, v.mb * 1024 * 1024 * 0.9))) {
    if (await exists(`.harnessx/${model}`, opts)) {
      try {
        await remove(`.harnessx/${model}`, opts);
      } catch {
        /* will overwrite */
      }
    }
    onStatus(`Downloading voice "${v.label}" (~${v.mb} MB, one-time)...`);
    await downloadFile(`${VOICES_BASE}/${v.path}/${v.id}.onnx`, model, `piper-${v.id}`);
  }
  if (!(await sizeOk(configRel(v), 100))) {
    await downloadFile(`${VOICES_BASE}/${v.path}/${v.id}.onnx.json`, configRel(v), `piper-${v.id}-cfg`);
  }
}

/** Synthesize text and return a playable data URL. */
export async function piperSynthesize(
  text: string,
  voiceId: string,
  human = true,
): Promise<string> {
  const v = piperVoice(voiceId);
  const out = `tmp/piper-out.wav`;
  await invoke<string>("piper_speak", {
    engineDir: ENGINE_DIR,
    model: modelRel(v),
    text,
    outWav: out,
    // Slightly slower pacing, more per-phoneme timing variation and a real gap
    // between sentences — the difference between "read aloud" and "spoken".
    lengthScale: human ? 1.05 : null,
    noiseW: human ? 0.9 : null,
    sentenceSilence: human ? 0.35 : null,
  });
  const bytes = await readFile(`.harnessx/${out}`, opts);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(bin)}`;
}

export async function piperReady(voiceId: string): Promise<boolean> {
  const v = piperVoice(voiceId);
  return (
    (await exists(`.harnessx/${ENGINE_DIR}`, opts)) &&
    (await sizeOk(modelRel(v), v.mb * 1024 * 1024 * 0.9))
  );
}
