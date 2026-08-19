import { useEffect, useState } from "react";

/**
 * Whether the device has a usable microphone for VoiceView.
 *
 * The desktop build uses the Rust cpal layer (via `listMicDevices`), which
 * works without a browser-permission prompt. The web build asks the browser
 * via `navigator.permissions.query` and waits for the user to grant the
 * page mic access. We never request the mic here — we only *detect* whether
 * the permission has been granted or is prompt-able.
 *
 * Three states:
 *   - "available"   at least one input device, or the browser says mic is OK
 *   - "unavailable" no devices, or the browser denies the permission
 *   - "unknown"     we couldn't tell (older browsers, no permissions API)
 *
 * Voice-first is the right default for "available" and "unknown" — a desktop
 * with a mic may not have its devices enumerated yet, and we'd rather show
 * the orb than default to text. Only "unavailable" flips the default.
 */
export type MicStatus = "available" | "unavailable" | "unknown";

export function useMicAvailable(): MicStatus {
  const [status, setStatus] = useState<MicStatus>("unknown");

  useEffect(() => {
    let cancelled = false;

    const detect = async (): Promise<MicStatus> => {
      // Tauri: ask the Rust audio layer. Falls back to "unknown" if the
      // invoke isn't available (e.g. running tests, or web build).
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const devices = await invoke<string[]>("mic_devices");
        if (!cancelled) return devices.length > 0 ? "available" : "unavailable";
      } catch {
        /* not a Tauri build — fall through to the browser check */
      }

      // Browser: query permissions. `navigator.permissions` is missing on
      // older Safari; treat absence as "unknown" rather than "unavailable".
      if (typeof navigator === "undefined" || !navigator.permissions) {
        return "unknown";
      }
      try {
        const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (cancelled) return "unknown";
        return result.state === "denied" ? "unavailable" : "available";
      } catch {
        return "unknown";
      }
    };

    void detect().then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
