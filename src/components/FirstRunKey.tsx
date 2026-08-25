import { useState } from "react";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";

/**
 * The first-run path, inline in the empty chat.
 *
 * This replaces a modal chooser that sent a new user to Discover, then to a
 * provider card, then to Settings, and left them to find their way back to a
 * conversation. Download-to-first-message was eight to ten steps; the point of
 * this component is that it is three — open the app, paste a key, send.
 *
 * Anthropic is pre-filled because it has the shortest path from "I want to try
 * this" to a working key, not because it is the only option. The alternatives
 * are one click away and deliberately phrased as equals: a local model needs no
 * key at all, and every other provider still lives in Discover.
 *
 * The trust line sits here rather than in SECURITY.md because this is the moment
 * a stranger decides whether to paste a credential into an unfamiliar app. It is
 * also the only claim on screen that a competitor cannot copy without rebuilding
 * their product.
 */
export function FirstRunKey() {
  const { settings, saveSettings, updateChat, setView } = useStore();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const provider = settings.providers.find((p) => p.id === "anthropic");

  const connect = async () => {
    const trimmed = key.trim();
    if (!trimmed || !provider) return;
    setBusy(true);
    try {
      const next = structuredClone(settings);
      const target = next.providers.find((p) => p.id === "anthropic");
      if (!target) return;
      target.apiKey = trimmed;
      await saveSettings(next);
      // Land them on a working model rather than an empty selector.
      updateChat({ providerId: "anthropic", model: target.models[0] ?? "claude-sonnet-5" });
      setKey("");
      toast.success("Connected — send your first message.");
    } catch (e) {
      toast.error((e as Error).message || "Could not save the key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="firstrun">
      <p className="empty-hint">Paste an API key to start. It goes straight to your OS keychain.</p>

      <div className="firstrun-row">
        <input
          className="grow"
          type="password"
          value={key}
          autoFocus
          placeholder="sk-ant-..."
          aria-label="Anthropic API key"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && void connect()}
        />
        <button className="btn primary" disabled={!key.trim() || busy} onClick={() => void connect()}>
          {busy ? "Connecting..." : "Connect"}
        </button>
      </div>

      <p className="empty-hint firstrun-alt">
        Need a key?{" "}
        <button className="link-btn" onClick={() => void openExternal("https://console.anthropic.com/settings/keys")}>
          Get one from Anthropic
        </button>
        {" · "}
        <button
          className="link-btn"
          onClick={() => {
            // Same deep-link mechanism as the local-model link below: the
            // Settings view restores its tab from this key.
            localStorage.setItem("hs-settings-tab", "subscriptions");
            setView("settings");
          }}
        >
          Already have Claude Pro or Copilot?
        </button>
        {" · "}
        <button className="link-btn" onClick={() => setView("discover")}>
          Use a different provider
        </button>
        {" · "}
        <button
          className="link-btn"
          onClick={() => {
            sessionStorage.setItem("hs-discover-tab", "local");
            setView("discover");
          }}
        >
          Run a local model free
        </button>
      </p>

      <p className="trust-line">
        Local-first. No account. No telemetry. Your keys stay in your OS keychain. Your chats never
        leave your machine.
      </p>
    </div>
  );
}

async function openExternal(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank");
  }
}
