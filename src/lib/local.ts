import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";

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

export const startServer = (engineDir: string, modelPath: string, ctx: number, gpuLayers: number) =>
  invoke("start_server", {
    engineDir,
    modelPath,
    port: LOCAL_PORT,
    ctx,
    gpuLayers,
  });

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
