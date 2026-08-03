import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { isWeb, hasWebGPU } from "../lib/web";
import { WEBLLM_MODELS, preloadWebLLM, webllmCached } from "../lib/providers/webllm";
import { GetDesktopApp } from "./GetDesktopApp";
import { toast } from "../lib/toast";

const PROVIDER_ID = "webllm";

/**
 * Settings card for running a model on WebGPU — inside the browser tab on the
 * web build, and inside the app's WebView on desktop (Windows WebView2 has
 * WebGPU). Zero setup: no key, no server, no separate engine download; after the
 * one-time model download it runs offline. It complements — doesn't replace —
 * the desktop's native llama.cpp models, which go bigger and use the GPU harder.
 */
export function WebLlmCard() {
  const { settings, saveSettings, setView } = useStore();
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [prog, setProg] = useState<Record<string, { pct: number; text: string }>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const supported = hasWebGPU();

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

  const existing = settings.providers.find((p) => p.id === PROVIDER_ID);

  // No WebGPU: on the web build, point at the desktop app; on desktop (e.g. the
  // Linux WebView, which lacks WebGPU), point at the native local models instead
  // — never tell a desktop user to "download the desktop app".
  if (!supported) {
    return (
      <>
        <h2>Run a model with WebGPU</h2>
        {isWeb() ? (
          <>
            <p className="hint">
              Running a model in the tab needs <b>WebGPU</b>, which this browser doesn't have. Use a
              recent Chrome or Edge — or run full local models on the desktop app.
            </p>
            <GetDesktopApp feature="local-models" />
          </>
        ) : (
          <p className="hint">
            This system's WebView has no WebGPU, so in-tab models aren't available here. You can still
            run full local models natively —{" "}
            <button className="link-btn" onClick={() => setView("models")}>
              open My Models
            </button>{" "}
            or <button className="link-btn" onClick={() => setView("discover")}>Discover</button> to
            download a GGUF and run it with llama.cpp.
          </p>
        )}
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
      <h2>Run a model with WebGPU</h2>
      <p className="hint">
        Runs entirely on your GPU {isWeb() ? "in this tab" : "inside the app"} — no key, no server,
        and after the first download (cached here), no network. Zero setup; capped at small models.
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
                  <span className="pill ok" title="Weights cached here">
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
      {isWeb() ? (
        <>
          <p className="hint">
            Want bigger models, or fully offline llama.cpp with any GGUF from Hugging Face?{" "}
            That's the desktop app.
          </p>
          <GetDesktopApp feature="local-models" compact />
        </>
      ) : (
        <p className="hint">
          For bigger models and full GPU offload, use native local models —{" "}
          <button className="link-btn" onClick={() => setView("discover")}>
            Discover
          </button>{" "}
          downloads any GGUF from Hugging Face and runs it with llama.cpp.
        </p>
      )}
    </>
  );
}
