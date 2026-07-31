import { invoke } from "@tauri-apps/api/core";

/** Native microphone recorder (Rust/cpal) — no WebView2 permission prompt. */
export interface Recorder {
  stopPath: () => Promise<string>; // returns WAV path relative to ~/.harnessx
}

/** Start recording. `device` is a name from listMicDevices(); blank = system default. */
export async function startRecording(device?: string): Promise<Recorder> {
  await invoke("mic_start", { device: device?.trim() || null });
  return {
    stopPath: () => invoke<string>("mic_stop"),
  };
}

/** Available input devices; the system default is first. */
export async function listMicDevices(): Promise<string[]> {
  try {
    return await invoke<string[]>("mic_devices");
  } catch {
    return [];
  }
}

/** Current input level (0..~1) while recording — used by the mic test meter. */
export async function micLevel(): Promise<number> {
  try {
    return await invoke<number>("mic_level");
  } catch {
    return 0;
  }
}
