import { useCallback, useEffect, useState } from "react";
import { fitFor, FIT_LABEL } from "../lib/catalog";
import {
  hwInfo,
  installEngine,
  LOCAL_PORT,
  serverStatus,
  startServer,
  stopServer,
  type HwInfo,
  type ServerStatus,
} from "../lib/local";
import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isWeb } from "../lib/web";
import { GetDesktopApp } from "./GetDesktopApp";
import { confirmDialog } from "../lib/dialog";
import { listModels } from "../lib/providers";
import { useStore } from "../lib/store";
import * as storage from "../lib/storage";
import type { LocalModel } from "../lib/storage";
import { EmptyState } from "./EmptyState";
import { IconBox, IconCloud } from "./icons";

export function ModelsView() {
  const { ensureLocalProvider, setView, selectChat, chats, updateChat, settings, saveSettings } =
    useStore();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editModels, setEditModels] = useState("");
  const [editKey, setEditKey] = useState("");
  const [engines, setEngines] = useState<string[]>([]);
  const [hw, setHw] = useState<HwInfo | null>(null);
  const [status, setStatus] = useState<ServerStatus>({ running: false, model: null, port: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ctx, setCtx] = useState(4096);
  const [gpuLayers, setGpuLayers] = useState(-1);
  // Advanced launch flags. Sensible defaults: flash attention on (broad win),
  // everything else off/auto so nothing breaks an older engine.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [flashAttn, setFlashAttn] = useState(true);
  const [mlock, setMlock] = useState(false);
  const [cpuMoe, setCpuMoe] = useState<string>(""); // blank = off; "0" = all experts to RAM
  const [threads, setThreads] = useState<string>("");
  const [notice, setNotice] = useState<string | null>(null);
  const [colibriUrl, setColibriUrl] = useState("http://localhost:8080/v1");

  const connectColibri = async () => {
    setError(null);
    setNotice(null);
    try {
      const base = colibriUrl.replace(/\/+$/, "");
      const provider = {
        id: "colibri",
        name: "Colibri (local)",
        kind: "openai-compatible" as const,
        baseUrl: base,
        apiKey: "",
        models: [],
      };
      const names = await listModels(provider);
      if (!names.length) {
        setError("Connected, but Colibri reported no models. Is `coli serve --model <path>` running and loaded?");
        return;
      }
      const s = structuredClone(useStore.getState().settings);
      let p = s.providers.find((x) => x.id === "colibri");
      if (!p) {
        p = { ...provider };
        s.providers.push(p);
      }
      p.baseUrl = base;
      p.models = names;
      await useStore.getState().saveSettings(s);
      setNotice(`Colibri connected — ${names.length} model(s). Pick "Colibri (local)" in any chat.`);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setError(
        msg.includes("error sending request")
          ? `Could not reach Colibri at ${colibriUrl} — start it with 'python coli serve --model <path>' and check the port.`
          : `Colibri connect failed: ${msg}`,
      );
    }
  };

  const importLmStudio = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("http://127.0.0.1:1234/v1/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const names: string[] = (json.data ?? []).map((m: { id: string }) => m.id);
      if (!names.length) {
        setError("LM Studio's server is running but reports no models — download one in LM Studio first.");
        return;
      }
      const settings = structuredClone(useStore.getState().settings);
      let p = settings.providers.find((x) => x.id === "lmstudio");
      if (!p) {
        p = {
          id: "lmstudio",
          name: "LM Studio (local)",
          kind: "openai-compatible",
          baseUrl: "http://localhost:1234/v1",
          apiKey: "",
          models: [],
        };
        settings.providers.push(p);
      }
      p.models = names;
      await useStore.getState().saveSettings(settings);
      setNotice(
        `Imported ${names.length} LM Studio model(s) — pick "LM Studio (local)" as the provider in any chat.`,
      );
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setError(
        msg.includes("error sending request")
          ? "Could not reach LM Studio at 127.0.0.1:1234 — start its server (Developer tab > Status: Running)."
          : `LM Studio import failed: ${msg}`,
      );
    }
  };

  const importLlamaCpp = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("http://127.0.0.1:8080/v1/models");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const names: string[] = (json.data ?? []).map((m: { id: string }) => m.id);
      if (!names.length) {
        setError("llama-server is running but reports no model — start it with `llama-server -m your-model.gguf`.");
        return;
      }
      const settings = structuredClone(useStore.getState().settings);
      let p = settings.providers.find((x) => x.id === "llamacpp");
      if (!p) {
        p = {
          id: "llamacpp",
          name: "llama.cpp (local)",
          kind: "openai-compatible",
          baseUrl: "http://localhost:8080/v1",
          apiKey: "",
          models: [],
        };
        settings.providers.push(p);
      }
      p.models = names;
      await useStore.getState().saveSettings(settings);
      setNotice(
        `Imported ${names.length} llama.cpp model(s) — pick "llama.cpp (local)" as the provider in any chat.`,
      );
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setError(
        msg.includes("error sending request")
          ? "Could not reach llama-server at 127.0.0.1:8080 — start it with `llama-server -m your-model.gguf` (it serves the OpenAI API on :8080)."
          : `llama.cpp import failed: ${msg}`,
      );
    }
  };

  const importOllama = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("http://127.0.0.1:11434/api/tags");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const names: string[] = (json.models ?? []).map((m: { name: string }) => m.name);
      if (!names.length) {
        setError("Ollama is running but has no models installed (try: ollama pull llama3.2).");
        return;
      }
      const settings = structuredClone(useStore.getState().settings);
      let p = settings.providers.find((x) => x.id === "ollama");
      if (!p) {
        p = {
          id: "ollama",
          name: "Ollama (local)",
          kind: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          apiKey: "",
          models: [],
        };
        settings.providers.push(p);
      }
      p.models = names;
      await useStore.getState().saveSettings(settings);
      setNotice(
        `Imported ${names.length} Ollama model(s) — pick "Ollama (local)" as the provider in any chat.`,
      );
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setError(
        msg.includes("error sending request")
          ? "Could not reach Ollama at 127.0.0.1:11434 — is Ollama installed and running?"
          : `Ollama import failed: ${msg}`,
      );
    }
  };

  const refresh = useCallback(async () => {
    setModels(await storage.listLocalModels());
    setEngines(await storage.listEngines());
    setStatus(await serverStatus());
  }, []);

  useEffect(() => {
    void refresh();
    void hwInfo().then(setHw);
    const t = setInterval(() => void serverStatus().then(setStatus), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const ensureEngine = async (): Promise<string> => {
    if (engines.length) return engines[0];
    if (!hw) throw new Error("hardware info not ready yet");
    const dir = await installEngine(hw, (s) => setBusy(s));
    setEngines([dir]);
    return dir;
  };

  const load = async (m: LocalModel) => {
    setError(null);
    try {
      setBusy("Preparing engine…");
      const engine = await ensureEngine();
      setBusy(`Loading ${m.file}…`);
      await startServer(engine, m.relPath, ctx, gpuLayers, {
        flashAttn,
        mlock,
        cpuMoe: cpuMoe.trim() === "" ? undefined : Number(cpuMoe),
        threads: threads.trim() === "" ? undefined : Number(threads),
      });
      // wait for the server to answer, then register the Local provider
      let modelIds: string[] = [];
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await serverStatus();
        if (!st.running) throw new Error("llama-server exited while loading — model may not fit in memory.");
        try {
          modelIds = await listModels({
            id: "local",
            name: "local",
            kind: "openai-compatible",
            baseUrl: `http://127.0.0.1:${LOCAL_PORT}/v1`,
            apiKey: "",
            models: [],
          });
          break;
        } catch {
          /* not up yet */
        }
      }
      if (!modelIds.length) throw new Error("Local server did not become ready in 60s.");
      await ensureLocalProvider(LOCAL_PORT, modelIds);
      setStatus(await serverStatus());
      // point the current chat at the local model for convenience
      const chat = chats[0];
      if (chat) {
        selectChat(chat.id);
        updateChat({ providerId: "local", model: modelIds[0] });
      }
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const eject = async () => {
    await stopServer();
    setStatus(await serverStatus());
  };

  const openEdit = (id: string) => {
    const p = settings.providers.find((x) => x.id === id);
    if (!p) return;
    setEditProvider(id);
    setEditModels(p.models.join("\n"));
    setEditKey(p.apiKey);
  };

  const saveEdit = async () => {
    const s = structuredClone(settings);
    const p = s.providers.find((x) => x.id === editProvider);
    if (p) {
      p.models = editModels.split(/[\n,]/).map((m) => m.trim()).filter(Boolean);
      p.apiKey = editKey.trim();
      await saveSettings(s);
    }
    setEditProvider(null);
  };

  const removeProvider = async (id: string) => {
    if (!(await confirmDialog("Remove this provider?", { danger: true }))) return;
    const s = structuredClone(settings);
    s.providers = s.providers.filter((x) => x.id !== id);
    await saveSettings(s);
  };

  const useInChat = (providerId: string, model: string) => {
    const chat = chats[0];
    if (chat) {
      selectChat(chat.id);
      updateChat({ providerId, model });
    }
  };

  // remote/cloud providers = everything except the local llama-server provider
  const remoteProviders = settings.providers.filter((p) => p.id !== "local" && p.models.length > 0);

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>My Models</h1>
        <div>
          <button className="btn" onClick={() => void importLlamaCpp()} title="List the model from a running llama.cpp llama-server (:8080) and add it as a chat provider">
            Import from llama.cpp
          </button>{" "}
          <button className="btn" onClick={() => void importOllama()} title="List models from a running Ollama install and add them as a chat provider">
            Import from Ollama
          </button>{" "}
          <button className="btn" onClick={() => void importLmStudio()} title="List models from a running LM Studio server and add them as a chat provider">
            Import from LM Studio
          </button>{" "}
          <button className="btn" onClick={() => setView("discover")}>
            Get more models
          </button>
        </div>
      </div>
      {isWeb() && (
        <GetDesktopApp
          reason="Downloading and running local GGUF models (llama.cpp) happens on your machine — that needs the desktop app. In the browser, run small models on WebGPU from Settings → Providers."
        />
      )}
      {notice && <p className="hint">{notice}</p>}

      {hw && (
        <p className="hint">
          {Math.round(hw.total_ram_mb / 1024)} GB RAM
          {hw.gpu_name ? ` · ${hw.gpu_name} (${Math.round((hw.vram_mb ?? 0) / 1024)} GB VRAM)` : " · no NVIDIA GPU detected"}
          {hw.avx2 ? "" : " · Warning: CPU lacks AVX2 — standard llama.cpp builds will not run"}
        </p>
      )}

      <section className="server-card">
        {status.running ? (
          <>
            <span className="dot on" /> Local server running on port {status.port} —{" "}
            <code>{status.model}</code>{" "}
            <button className="btn danger small" onClick={() => void eject()}>
              Eject
            </button>
          </>
        ) : (
          <>
            <span className="dot" /> No model loaded
          </>
        )}
      </section>

      {busy && <p className="hint">{busy}</p>}
      {error && <div className="error-banner">{error}</div>}

      <section>
        <h2>Connected providers</h2>
        {remoteProviders.length === 0 && (
          <EmptyState
            icon={<IconCloud size={22} />}
            title="No cloud providers yet"
            hint="Add a provider from Discover, or import from LM Studio."
            action={{ label: "Open Discover", onClick: () => setView("discover") }}
          />
        )}
        {remoteProviders.map((p) => {
          const editing = editProvider === p.id;
          const hasKey = p.apiKey.trim().length > 0;
          const localish = p.id === "ollama" || p.id === "lmstudio" || p.id === "llamacpp";
          return (
            <div key={p.id} className="provider-card">
              <div className="provider-row">
                <div className="grow">
                  <b>{p.name}</b>{" "}
                  <span className="hint">
                    {p.models.length} model(s) · {p.baseUrl}
                  </span>
                  <div className="hint">
                    {localish
                      ? "Local server — no API key needed"
                      : hasKey
                        ? "API key set"
                        : "No API key set — click Edit to add one"}
                  </div>
                </div>
                <button className="btn small" onClick={() => (editing ? setEditProvider(null) : openEdit(p.id))}>
                  {editing ? "Close" : "Edit"}
                </button>
                <button className="icon-btn" title="Remove provider" onClick={() => void removeProvider(p.id)}>
                  x
                </button>
              </div>

              {editing ? (
                <div className="wf-edit">
                  {!localish && (
                    <label className="field">
                      <span>API key</span>
                      <input
                        type="password"
                        value={editKey}
                        placeholder="Paste API key"
                        onChange={(e) => setEditKey(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="field">
                    <span>Models (one per line)</span>
                    <textarea
                      rows={5}
                      className="code"
                      value={editModels}
                      onChange={(e) => setEditModels(e.target.value)}
                    />
                  </label>
                  <div className="provider-row">
                    <button className="btn primary small" onClick={() => void saveEdit()}>
                      Save
                    </button>
                    <button className="btn small" onClick={() => setEditProvider(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="model-chips">
                  {p.models.slice(0, 12).map((m) => (
                    <button
                      key={m}
                      className="model-chip"
                      title="Use this model in the current chat"
                      onClick={() => useInChat(p.id, m)}
                    >
                      {m}
                    </button>
                  ))}
                  {p.models.length > 12 && <span className="hint">+{p.models.length - 12} more</span>}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section>
        <h2>Huge MoE models — Colibri (SSD-streamed)</h2>
        <p className="hint">
          Colibri runs enormous Mixture-of-Experts models (e.g. GLM-5.2, 744B) on a normal machine by
          streaming experts from your SSD — a near-frontier open model on ~25 GB RAM. It's slow
          (seconds-to-minutes per token depending on your NVMe) but free and fully local. You run
          Colibri's OpenAI-compatible server; HarnessStation connects to it.
        </p>
        <details className="tool-msg" style={{ marginBottom: 10 }}>
          <summary>One-time setup (manual — ~370 GB download + a source build)</summary>
          <ol style={{ fontSize: 12, lineHeight: 1.6, paddingLeft: 18 }}>
            <li>Install a MinGW-w64 toolchain (e.g. <code>scoop install mingw</code> or portable w64devkit) and Python 3.</li>
            <li>Clone <code>github.com/JustVugg/colibri</code> and build: <code>cd c &amp;&amp; ./setup.sh</code>.</li>
            <li>Download the int4 weights (~370 GB) from Hugging Face (<code>mateogrgic/GLM-5.2-colibri-int4-with-int8-mtp</code>) to a fast SSD.</li>
            <li>Convert once: <code>coli convert --model D:\glm52_i4</code>.</li>
            <li>Serve: <code>python coli serve --model D:\glm52_i4</code> — note the port it prints.</li>
            <li>Put that server's URL below and click Connect.</li>
          </ol>
          <div className="provider-row" style={{ marginTop: 4 }}>
            <button className="link-btn" onClick={() => void openUrl("https://github.com/JustVugg/colibri")}>Colibri repo</button>
            <button className="link-btn" onClick={() => void openUrl("https://huggingface.co/mateogrgic/GLM-5.2-colibri-int4-with-int8-mtp")}>Model weights</button>
          </div>
        </details>
        <div className="provider-row">
          <input
            className="grow"
            value={colibriUrl}
            placeholder="Colibri server URL, e.g. http://localhost:8080/v1"
            onChange={(e) => setColibriUrl(e.target.value)}
          />
          <button className="btn primary" onClick={() => void connectColibri()}>
            Connect
          </button>
        </div>
      </section>

      <section>
        <h2>Local models (GGUF)</h2>
        <div className="load-opts">
          <label>
            Context <input type="number" value={ctx} min={512} step={512} onChange={(e) => setCtx(Number(e.target.value) || 4096)} />
          </label>
          <label>
            GPU layers (-1 = all){" "}
            <input type="number" value={gpuLayers} min={-1} onChange={(e) => setGpuLayers(Number(e.target.value))} />
          </label>
          <button className="link-btn" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced" : "Advanced ▾"}
          </button>
        </div>

        {showAdvanced && (
          <div className="load-opts-advanced">
            <label className="check">
              <input type="checkbox" checked={flashAttn} onChange={(e) => setFlashAttn(e.target.checked)} />
              Flash attention — faster, less memory (needs a recent engine)
            </label>
            <label className="check">
              <input type="checkbox" checked={mlock} onChange={(e) => setMlock(e.target.checked)} />
              Lock in RAM (no swap to disk) — needs enough RAM
            </label>
            <label>
              MoE experts → RAM{" "}
              <input
                type="number"
                min={0}
                placeholder="off"
                value={cpuMoe}
                style={{ width: 70 }}
                onChange={(e) => setCpuMoe(e.target.value)}
              />
              <span className="hint"> 0 = all experts in RAM; N = first N layers. Runs big MoE models on a small GPU.</span>
            </label>
            <label>
              CPU threads{" "}
              <input
                type="number"
                min={1}
                placeholder={hw ? "auto" : ""}
                value={threads}
                style={{ width: 60 }}
                onChange={(e) => setThreads(e.target.value)}
              />
              <span className="hint"> Blank = engine default. Around your physical core count.</span>
            </label>
          </div>
        )}
        {models.length === 0 && (
          <EmptyState
            icon={<IconBox size={22} />}
            title="No local models yet"
            hint="Download a model in Discover to run it on your own hardware."
            action={{ label: "Open Discover", onClick: () => setView("discover") }}
          />
        )}
        {models.map((m) => {
          const fit = hw ? fitFor(m.sizeMB, hw.total_ram_mb, hw.vram_mb) : null;
          const loaded = status.running && status.model === m.relPath;
          return (
            <div key={m.relPath} className="provider-card">
              <div className="provider-row">
                <div className="grow">
                  <b>{m.file}</b>
                  <div className="hint">
                    {m.publisher}/{m.model} · {(m.sizeMB / 1024).toFixed(1)} GB
                    {fit && <span className={`fit fit-${fit}`}> · {FIT_LABEL[fit]}</span>}
                  </div>
                </div>
                {loaded ? (
                  <button className="btn danger" onClick={() => void eject()}>
                    Eject
                  </button>
                ) : (
                  <button className="btn primary" disabled={!!busy} onClick={() => void load(m)}>
                    Load
                  </button>
                )}
                <button
                  className="icon-btn"
                  title="Delete model file"
                  onClick={async () => {
                    if (await confirmDialog(`Delete ${m.file} from disk?`, { danger: true })) {
                      void storage.deleteLocalModel(m.relPath).then(refresh);
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
