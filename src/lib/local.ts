import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";
import type { EngineKind } from "./engines";

export const LOCAL_PORT = 1244;

export interface HwInfo {
  total_ram_mb: number;
  avx2: boolean;
  gpu_name: string | null;
  vram_mb: number | null;
}

export interface ServerStatus {
  running: boolean;
  model: string | null;
  port: number | null;
}

export interface DownloadProgress {
  id: string;
  received: number;
  total: number | null;
  done: boolean;
}

export const hwInfo = () => invoke<HwInfo>("hw_info");
export const serverStatus = () => invoke<ServerStatus>("server_status");
export const stopServer = () => invoke("stop_server");

/** Optional llama-server performance flags. Only what's set is passed through. */
export interface LaunchOpts {
  /** CPU threads (`--threads`). */
  threads?: number;
  /** MoE expert offload: 0 = all experts to RAM (`--cpu-moe`), N = first N layers. */
  cpuMoe?: number;
  /** Flash attention (`--flash-attn on`) — on by default; a broad speed/memory win. */
  flashAttn?: boolean;
  /** Pin the model in RAM (`--mlock`). */
  mlock?: boolean;
  /** Load fully into RAM rather than mmap (`--no-mmap`). */
  noMmap?: boolean;
  /** Disable llama.cpp auto-fit (`--fit off`). */
  fitOff?: boolean;
  /** Auto-fit VRAM margin per GPU, MB (`--fit-target`). */
  fitTarget?: number;
  /**
   * Multi-token prediction (`--spec-type draft-mtp`) — ~1.5–2x tokens/sec with
   * no second model in memory, because the draft heads ship inside the model.
   *
   * Needs llama.cpp build 9200+ *and* a GGUF built with MTP heads; on a normal
   * GGUF the flag is silently inert. Long generations benefit most — below a few
   * hundred output tokens the speedup doesn't show up.
   */
  mtp?: boolean;
  /** Draft tokens per step (`--spec-draft-n-max`): 2 for dense, 3 for MoE. */
  specDraftNMax?: number;
  /**
   * Minimum acceptance probability for a draft token (`--spec-draft-p-min`).
   * Effectively required: without it, rejection on long contexts eats the gain.
   */
  specDraftPMin?: number;

  // ---- ik_llama.cpp only. Dropped before the command line on other engines. ----
  /**
   * Run-time repack (`-rtr`): rewrite tensors into row-interleaved layout during
   * load so CPU matmul hits the fork's IQK kernels. The main reason to run
   * ik_llama on a CPU-only machine.
   *
   * Trades load time and memory for throughput — the fork turns mmap off when
   * this is set, so the model is read in full rather than paged from disk.
   */
  rtr?: boolean;
  /** Smart expert reduction (`-ser`) as the fork's `min,threshold` pair, e.g. "5,1". */
  ser?: string;
  /** Attention compute buffer cap in MB (`-amb`). The fork raises anything under 128. */
  amb?: number;
}

/** Defaults applied when the user turns MTP on but doesn't tune it. */
export const MTP_DEFAULTS = { specDraftNMax: 2, specDraftPMin: 0.75 } as const;

export const startServer = (
  engineDir: string,
  modelPath: string,
  ctx: number,
  gpuLayers: number,
  opts: LaunchOpts = {},
  engine: EngineKind = "llama.cpp",
) =>
  invoke("start_server", {
    engineDir,
    modelPath,
    port: LOCAL_PORT,
    ctx,
    gpuLayers,
    opts,
    engine,
  });

/**
 * Resolve the `llama-server` inside an engine directory, or null if there
 * isn't one. Cheap, and it turns "wrong folder" into a clear message instead of
 * a spawn failure that reads like the model didn't fit in memory.
 */
export const probeEngine = (engineDir: string) =>
  invoke<string | null>("probe_engine", { engineDir });

export const downloadFile = (url: string, dest: string, id: string) =>
  invoke("download", { url, dest, id });

export const extractZip = (zip: string, dest: string) => invoke("extract_zip", { zip, dest });

export function onDownloadProgress(cb: (p: DownloadProgress) => void): Promise<UnlistenFn> {
  return listen<DownloadProgress>("download-progress", (e) => cb(e.payload));
}

/** Pick + download the right llama.cpp server build from the latest GitHub release. */
export async function installEngine(
  hw: HwInfo,
  onStatus: (s: string) => void,
): Promise<string> {
  onStatus("Fetching latest llama.cpp release…");
  const res = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
    headers: { "User-Agent": "HarnessX" },
  });
  if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
  const rel = await res.json();
  const assets: { name: string; browser_download_url: string }[] = rel.assets ?? [];
  const win = assets.filter((a) => /win/i.test(a.name) && /x64/i.test(a.name) && a.name.endsWith(".zip"));

  const pick = (needle: string) => win.find((a) => a.name.toLowerCase().includes(needle));
  let kind = "cpu";
  let main = pick("cpu") ?? pick("avx2");
  const extras: typeof win = [];
  if (hw.gpu_name) {
    const cuda = pick("cuda");
    if (cuda) {
      kind = "cuda";
      main = cuda;
      const cudart = assets.find((a) => a.name.toLowerCase().startsWith("cudart") && /win/i.test(a.name));
      if (cudart) extras.push(cudart);
    } else {
      const vulkan = pick("vulkan");
      if (vulkan) {
        kind = "vulkan";
        main = vulkan;
      }
    }
  } else {
    const vulkan = pick("vulkan");
    if (vulkan && !main) {
      kind = "vulkan";
      main = vulkan;
    }
  }
  if (!main) throw new Error("No suitable llama.cpp Windows build found in the latest release.");

  const tag = rel.tag_name ?? "latest";
  const engineDir = `engines/llama.cpp-${tag}-${kind}`;
  for (const asset of [main, ...extras]) {
    onStatus(`Downloading ${asset.name}…`);
    const zipRel = `engines/${asset.name}`;
    await downloadFile(asset.browser_download_url, zipRel, `engine-${asset.name}`);
    onStatus(`Extracting ${asset.name}…`);
    await extractZip(zipRel, engineDir);
  }
  return engineDir;
}
