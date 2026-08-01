import { invoke } from "@tauri-apps/api/core";

/** Native microphone recorder (Rust/cpal) — no WebView2 permission prompt. */
export interface Recorder {
  /** Stop recording and return the WAV path, relative to ~/.harnessx. */
  stopPath: () => Promise<string>;
  /**
   * Take everything captured so far as a segment and KEEP RECORDING.
   * This is what lets the avatar stay open while it transcribes and answers,
   * instead of going deaf between the end of your sentence and its reply.
   */
  takePath: () => Promise<string>;
  /** Copy the audio so far without consuming it, for rolling live transcription. */
  snapshotPath: () => Promise<string>;
}

/** Start recording. `device` is a name from listMicDevices(); blank = system default. */
export async function startRecording(device?: string): Promise<Recorder> {
  await invoke("mic_start", { device: device?.trim() || null });
  return {
    stopPath: () => invoke<string>("mic_stop"),
    takePath: () => invoke<string>("mic_take"),
    snapshotPath: () => invoke<string>("mic_snapshot"),
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
