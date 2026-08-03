import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { isWeb, hasWebGPU } from "../lib/web";
import { WEBLLM_MODELS, preloadWebLLM, webllmCached } from "../lib/providers/webllm";
import { GetDesktopApp } from "./GetDesktopApp";
import { toast } from "../lib/toast";

const PROVIDER_ID = "webllm";

/**
 * Settings card for running a model inside the browser tab (WebGPU / WebLLM).
 * Web-only. Explains the trade (a big one-time download, small models), lets you
 * pre-download each model, and — when the browser can't do it — points at the
 * desktop app.
 */
export function WebLlmCard() {
  const { settings, saveSettings } = useStore();
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [prog, setProg] = useState<Record<string, { pct: number; text: string }>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const supported = isWeb() && hasWebGPU();

  // Which models are already downloaded, so we can show "Downloaded" vs "Download".
  useEffect(() => {
    if (!supported) return;
    let live = true;
    void Promise.all(WEBLLM_MODELS.map(async (m) => [m.id, await webllmCached(m.id)] as const)).then(
      (rows) => live && setCached(Object.fromEntries(rows)),
    );
    return () => {
      live = false;
    };
  }, [supported]);

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

  /** Add the provider so a downloaded model is immediately selectable in chats. */
  const ensureProvider = async () => {
    if (settings.providers.some((p) => p.id === PROVIDER_ID)) return;
    await saveSettings({
      ...settings,
      providers: [
        {
          id: PROVIDER_ID,
          name: "In-browser (WebGPU)",
          kind: "webllm" as const,
          baseUrl: "",
          apiKey: "",
          models: WEBLLM_MODELS.map((m) => m.id),
        },
        ...settings.providers,
      ],
    });
  };

  const download = async (id: string, label: string) => {
    setDownloading(id);
    setProg((p) => ({ ...p, [id]: { pct: 0, text: "Starting…" } }));
    try {
      await ensureProvider();
      await preloadWebLLM(id, (pct, text) => setProg((p) => ({ ...p, [id]: { pct, text } })));
      setCached((c) => ({ ...c, [id]: true }));
      toast.success(`${label} is downloaded and ready.`);
    } catch (e) {
      toast.error(`Couldn't download ${label}: ${(e as Error).message || String(e)}`);
    } finally {
      setDownloading(null);
      setProg((p) => {
        const { [id]: _drop, ...rest } = p;
        return rest;
      });
    }
  };

  return (
    <>
      <h2>Run a model in your browser</h2>
      <p className="hint">
        Runs entirely in this tab on WebGPU — no key, no server, and after the first download
        (cached here), no network. Best for a quick, private try; browsers cap this at small models.
        Download one now so your first message is instant.
      </p>
      <div className="provider-card">
        <ul className="webllm-models">
          {WEBLLM_MODELS.map((m) => {
            const p = prog[m.id];
            const isDone = cached[m.id];
            const busy = downloading === m.id;
            return (
              <li key={m.id}>
                <span className="grow">
                  {m.label} <span className="hint">{m.size}</span>
                  {busy && p && (
                    <span className="webllm-prog">
                      <span className="webllm-prog-bar" style={{ width: `${p.pct}%` }} />
                      <span className="webllm-prog-text">{p.text || `${p.pct}%`}</span>
                    </span>
                  )}
                </span>
                {isDone ? (
                  <span className="pill ok" title="Weights cached in this browser">
                    Downloaded ✓
                  </span>
                ) : (
                  <button
                    className="btn small"
                    disabled={!!downloading}
                    onClick={() => void download(m.id, m.label)}
                  >
                    {busy ? "Downloading…" : "Download"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="hint" style={{ marginTop: 10 }}>
          {existing ? (
            <>
              Pick <b>In-browser (WebGPU)</b> as the provider in any chat, choose a model, and send.
            </>
          ) : (
            <>Downloading a model also adds the <b>In-browser (WebGPU)</b> provider automatically.</>
          )}
        </p>
      </div>
      <p className="hint">
        Want bigger models, or fully offline llama.cpp with any GGUF from Hugging Face?{" "}
        That's the desktop app.
      </p>
      <GetDesktopApp feature="local-models" compact />
    </>
  );
}
