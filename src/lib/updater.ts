import { toast } from "./toast";

export interface UpdateInfo {
  available: boolean;
  version?: string;
  notes?: string;
  current: string;
}

/** Check for an update. Returns info; does not install. Safe to call in dev (returns not-available). */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const { getVersion } = await import("@tauri-apps/api/app");
  const current = await getVersion().catch(() => "0.0.0");
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      return { available: true, version: update.version, notes: update.body, current };
    }
    return { available: false, current };
  } catch {
    // updater not configured (dev) or offline
    return { available: false, current };
  }
}

/** Download + install the pending update, then relaunch. */
export async function installUpdate(onProgress?: (pct: number) => void): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) {
    toast.info("No update available.");
    return;
  }
  let total = 0;
  let got = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      got += e.data.chunkLength;
      if (total) onProgress?.(Math.round((got / total) * 100));
    }
  });
  toast.success("Update installed — restarting...");
  await relaunch();
}
