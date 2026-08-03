import { useState } from "react";
import { useStore } from "../lib/store";
import { isWeb, hasWebGPU } from "../lib/web";
import { WEBLLM_MODELS } from "../lib/providers/webllm";
import { GetDesktopApp } from "./GetDesktopApp";
import { toast } from "../lib/toast";

const PROVIDER_ID = "webllm";

/**
 * Settings card for running a model inside the browser tab (WebGPU / WebLLM).
 * Web-only. Explains the trade (a big one-time download, small models), gates on
 * WebGPU, and — when the browser can't do it — points at the desktop app.
 */
export function WebLlmCard() {
  const { settings, saveSettings } = useStore();
  const [busy, setBusy] = useState(false);
  if (!isWeb()) return null; // desktop already runs real local models

  const existing = settings.providers.find((p) => p.id === PROVIDER_ID);

  if (!hasWebGPU()) {
    return (
      <>
        <h2>Run a model in your browser</h2>
        <p className="hint">
          Running a model in the tab needs <b>WebGPU</b>, which this browser doesn't have. Use a
          recent Chrome or Edge — or run full local models on the desktop app.
        </p>
        <GetDesktopApp feature="local-models" />
      </>
    );
  }

  const enable = async () => {
    setBusy(true);
    try {
      const providers = existing
        ? settings.providers
        : [
            {
              id: PROVIDER_ID,
              name: "In-browser (WebGPU)",
              kind: "webllm" as const,
              baseUrl: "",
              apiKey: "",
              models: WEBLLM_MODELS.map((m) => m.id),
            },
            ...settings.providers,
          ];
      await saveSettings({ ...settings, providers });
      toast.success(
        existing ? "In-browser models are already set up." : "Added the In-browser (WebGPU) provider.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Run a model in your browser</h2>
      <p className="hint">
        Runs entirely in this tab on WebGPU — no key, no server, and after the first download
        (cached here), no network. Best for a quick, private try; browsers cap this at small models.
      </p>
      <div className="provider-card">
        <div className="provider-row">
          <div className="grow">
            <b>Available models</b>
            <div className="hint">First use downloads the weights once — sizes are per model.</div>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void enable()}>
            {existing ? "Enabled ✓" : busy ? "Adding…" : "Enable in-browser models"}
          </button>
        </div>
        <ul className="webllm-models">
          {WEBLLM_MODELS.map((m) => (
            <li key={m.id}>
              <span>{m.label}</span>
              <span className="hint">{m.size}</span>
            </li>
          ))}
        </ul>
        {existing && (
          <p className="hint">
            Pick <b>In-browser (WebGPU)</b> as the provider in any chat, choose a model, and send —
            the first message downloads and loads it (progress shows in the chat).
          </p>
        )}
      </div>
      <p className="hint">
        Want bigger models, or fully offline llama.cpp with any GGUF from Hugging Face?{" "}
        That's the desktop app.
      </p>
      <GetDesktopApp feature="local-models" compact />
    </>
  );
}
