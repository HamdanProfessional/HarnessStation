import { useCallback, useEffect, useMemo, useState } from "react";
import { fitFor, fitCaveat, FIT_LABEL } from "../lib/catalog";
import { chatCapable, groupByModality, modalityOf, MODALITY_LABEL, MODALITY_TAG } from "../lib/modality";
import { toast } from "../lib/toast";
import {
  hwInfo,
  installEngine,
  LOCAL_PORT,
  serverStatus,
  startServer,
  stopServer,
  MTP_DEFAULTS,
  type HwInfo,
  type ServerStatus,
} from "../lib/local";
import { fetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isWeb } from "../lib/web";
import { GetDesktopApp } from "./GetDesktopApp";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { listModels } from "../lib/providers";
import { useStore } from "../lib/store";
import * as storage from "../lib/storage";
import type { LocalModel } from "../lib/storage";
import type { Provider } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { IconBox, IconCloud, IconX } from "./icons";

/** Quick-add shortcuts the wider audience reaches for first. Each row is a
 *  one-click path: add the provider, prompt for the key, save. */
const QUICK_PROVIDERS: { id: string; name: string; keyUrl: string; blurb: string }[] = [
  { id: "anthropic", name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", blurb: "Claude Opus, Sonnet, Haiku" },
  { id: "openai", name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", blurb: "GPT-5.6 Sol, Terra, Luna" },
  { id: "google", name: "Google", keyUrl: "https://aistudio.google.com/apikey", blurb: "Gemini 3.7 Flash, 3.1 Pro" },
  { id: "mistral", name: "Mistral", keyUrl: "https://console.mistral.ai/api-keys", blurb: "Mistral Large, Codestral" },
  { id: "groq", name: "Groq", keyUrl: "https://console.groq.com/keys", blurb: "GPT-OSS, Compound — free tier" },
  { id: "xai", name: "xAI (Grok)", keyUrl: "https://console.x.ai/", blurb: "Grok 4.6" },
];

export function ModelsView() {
  const { ensureLocalProvider, setView, selectChat, chats, currentId, updateChat, settings, saveSettings } =
    useStore();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [editModels, setEditModels] = useState("");
  const [editKey, setEditKey] = useState("");
  /**
   * Per-provider connection status.
   *
   * "Connected" was previously an assertion this page made and never checked: a
   * revoked key, a changed base URL or a local server that isn't running all
   * looked identical to a working provider, and you only found out in a chat
   * when the reply failed. Probing answers it here instead.
   */
  const [probes, setProbes] = useState<
    Record<string, { state: "checking" | "ok" | "error"; count?: number; error?: string; at?: number }>
  >({});
  /** Providers whose full model list is expanded past the first dozen. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
  // MTP is off by default: it needs build 9200+ and an MTP-built GGUF, and is a
  // no-op (not an error) when either is missing — so it can't be a default.
  const [mtp, setMtp] = useState(false);
  const [mtpDraft, setMtpDraft] = useState<string>(String(MTP_DEFAULTS.specDraftNMax));
  const [notice, setNotice] = useState<string | null>(null);
  const [colibriUrl, setColibriUrl] = useState("http://localhost:8080/v1");
  /** When true, the Colibri section is rendered. Off by default so a new user
   *  isn't asked to download a 370 GB model on their first visit. */
  const [showColibri, setShowColibri] = useState(false);

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
        mtp,
        // p-min isn't exposed: it has one sensible value and getting it wrong
        // quietly turns MTP into a slowdown, which is not a knob worth offering.
        ...(mtp
          ? {
              specDraftNMax: mtpDraft.trim() === "" ? MTP_DEFAULTS.specDraftNMax : Number(mtpDraft),
              specDraftPMin: MTP_DEFAULTS.specDraftPMin,
            }
          : {}),
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

  /**
   * Ask a provider what it can do, and believe the answer.
   *
   * One call does both jobs: `listModels` throws when the endpoint is
   * unreachable or the key is refused, which is the health check, and returns
   * the provider's own current list, which is the refresh. Doing them separately
   * would mean two buttons that can disagree.
   *
   * The stored list is only overwritten on a non-empty result — a provider that
   * answers with nothing is a bad reason to wipe models the user hand-entered.
   */
  const checkProvider = useCallback(async (p: Provider) => {
    setProbes((s) => ({ ...s, [p.id]: { state: "checking" } }));
    try {
      const names = await listModels(p);
      let changed = 0;
      if (names.length) {
        const next = structuredClone(useStore.getState().settings);
        const target = next.providers.find((x) => x.id === p.id);
        if (target) {
          changed = names.filter((n) => !target.models.includes(n)).length;
          target.models = names;
          await useStore.getState().saveSettings(next);
        }
      }
      setProbes((s) => ({
        ...s,
        [p.id]: { state: "ok", count: names.length, at: Date.now(), error: changed ? `${changed} new` : undefined },
      }));
    } catch (e) {
      // Surfaced verbatim: "HTTP 401" and "failed to fetch" point at different
      // fixes, and flattening them to "couldn't connect" hides which.
      setProbes((s) => ({
        ...s,
        [p.id]: { state: "error", error: (e as Error).message || String(e), at: Date.now() },
      }));
    }
  }, []);

  const removeProvider = async (id: string) => {
    if (!(await confirmDialog("Remove this provider?", { danger: true }))) return;
    const s = structuredClone(settings);
    s.providers = s.providers.filter((x) => x.id !== id);
    await saveSettings(s);
  };

  const useInChat = (providerId: string, model: string) => {
    const chat = chats[0];
    if (!chat) return;
    selectChat(chat.id);
    updateChat({ providerId, model });
    // Still switches to it — the classifier reads ids and can be wrong, so
    // refusing would sometimes block a perfectly good chat model. Saying what
    // it looks like turns a silent failure on send into a warning up front.
    const kind = modalityOf(model);
    if (!chatCapable(kind)) {
      toast.info(`${model} looks like a ${MODALITY_LABEL[kind].toLowerCase()} model — a chat may not be able to send to it.`);
    }
  };

  /**
   * One-click add for a popular provider. Adds the provider with a placeholder
   * base URL, then prompts for the key. Resolves to a saved provider with the
   * key set, or null if the user cancelled.
   *
   * The wider-audience path: button → paste key → done. Three steps, no
   * "where do I find this?" Required because most new users don't have an
   * API key in front of them — the keyUrl link points at the place to get one.
   */
  const quickAdd = async (qp: typeof QUICK_PROVIDERS[number]) => {
    const s = structuredClone(useStore.getState().settings);
    let prov = s.providers.find((x) => x.id === qp.id);
    if (!prov) {
      const known = (await import("../lib/catalog")).CLOUD_PROVIDERS.find((c) => c.id === qp.id);
      prov = {
        id: qp.id,
        name: known?.name ?? qp.name,
        kind: known?.kind ?? "openai-compatible",
        baseUrl: known?.baseUrl ?? "",
        apiKey: "",
        models: known?.models ?? [],
      };
      s.providers.push(prov);
    }
    const key = await promptDialog(`Add ${prov.name}`, {
      message: `Paste your ${prov.name} API key (get one at ${qp.keyUrl}). Leave blank to set it later in Settings.`,
      placeholder: "API key",
    });
    if (key && key.trim()) prov.apiKey = key.trim();
    await useStore.getState().saveSettings(s);
  };

  // remote/cloud providers = everything except the local llama-server provider
  const remoteProviders = settings.providers.filter((p) => p.id !== "local" && p.models.length > 0);
  /** The chat a "use this model" click would retarget, so its model can be marked. */
  const current = chats.find((c) => c.id === currentId);
  /** Any provider row that has been registered but not yet keyed. The quick-add
   *  empty state offers to fill these in. */
  const unkeyedProviders = settings.providers.filter((p) => p.id !== "local" && !p.apiKey.trim());
  const hasAnyKey = settings.providers.some((p) => p.id !== "local" && p.apiKey.trim().length > 0);
  /**
   * What rotation would actually have to choose between: model ids served by
   * more than one usable provider, and providers carrying a spare key. Either
   * one makes the toggle meaningful; neither does, and it stays hidden rather
   * than offering a switch that silently has no effect.
   */
  const rotatable = useMemo(() => {
    const seen = new Map<string, number>();
    let multiKey = 0;
    for (const p of settings.providers) {
      if (p.id !== "local" && !p.apiKey.trim()) continue;
      if ((p.apiKeys ?? []).filter((k) => k.trim()).length > 0) multiKey++;
      for (const m of new Set(p.models)) seen.set(m, (seen.get(m) ?? 0) + 1);
    }
    return { models: [...seen.values()].filter((n) => n > 1).length, multiKey };
  }, [settings.providers]);
  const canRotate = rotatable.models > 0 || rotatable.multiKey > 0;
  /** Plain-language summary of what a turn would be shared between. */
  const rotateSummary = [
    rotatable.models > 0 ? `${rotatable.models} shared model${rotatable.models === 1 ? "" : "s"}` : "",
    rotatable.multiKey > 0 ? `${rotatable.multiKey} provider${rotatable.multiKey === 1 ? "" : "s"} with spare keys` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>My Models</h1>
        <div className="grow" />
        <button className="btn" onClick={() => setView("discover")}>Browse catalog</button>
      </div>
      {isWeb() && (
        <GetDesktopApp
          reason="Downloading and running local GGUF models (llama.cpp) happens on your machine — that needs the desktop app. In the browser, run small models on WebGPU from Settings → Providers."
        />
      )}
      {notice && <p className="hint">{notice}</p>}

      {hasAnyKey && (
        <p className="hint">
          <b>Ready when you are.</b> Pick a model in any chat, or add another provider below.
        </p>
      )}

      {/* Local server status — only relevant when a local model is loaded. */}
      {(hw || status.running) && (
        <>
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
                <span className="dot" /> No local model loaded
              </>
            )}
          </section>
          {busy && <p className="hint">{busy}</p>}
          {error && <div className="error-banner">{error}</div>}
        </>
      )}

      <section>
        <div className="provider-row">
          <h2 className="grow">Connected providers</h2>
          {canRotate && (
            <label
              className="agent-check inline"
              title={
                "Spread turns evenly instead of always sending to the first option, so no single key " +
                "reaches its rate limit while the others idle. Rotates between providers listing the " +
                "identical model id, and between the spare keys on a provider — the reply comes from " +
                "the same weights either way. Failover still handles what happens after an error."
              }
            >
              <input
                type="checkbox"
                checked={settings.roundRobin === true}
                onChange={(e) => {
                  const next = structuredClone(useStore.getState().settings);
                  next.roundRobin = e.target.checked;
                  void useStore.getState().saveSettings(next);
                }}
              />
              Round-robin <span className="hint">({rotateSummary})</span>
            </label>
          )}
          {remoteProviders.length > 1 && (
            <button
              className="btn small"
              title="Check every provider at once"
              disabled={remoteProviders.some((p) => probes[p.id]?.state === "checking")}
              onClick={() => void Promise.all(remoteProviders.map((p) => checkProvider(p)))}
            >
              Check all
            </button>
          )}
        </div>
        {/* Spare keys are the main thing people want to rotate, and the field
            for them is a collapsed <details> on the far side of Settings. Saying
            so here costs one line and saves the search. */}
        {settings.roundRobin === true && (
          <p className="hint">
            Sharing each turn between {rotateSummary || "nothing yet"}. To add spare keys for one
            provider, open{" "}
            <button className="link-btn" onClick={() => setView("settings")}>
              Settings
            </button>{" "}
            → that provider → <em>Resilience — extra keys &amp; failover</em>.
          </p>
        )}
        {remoteProviders.length === 0 && unkeyedProviders.length === 0 && (
          <EmptyState
            icon={<IconCloud size={22} />}
            title="No cloud providers yet"
            hint="Add a provider below. Your key is stored in the OS keychain — never sent to us."
          />
        )}
        {/* The wider-audience path: when no provider has a key set, the row of
            quick-add cards is the primary action on this page. */}
        {!hasAnyKey && (
          <div className="quick-add">
            <div className="quick-add-grid">
              {QUICK_PROVIDERS.map((qp) => (
                <button
                  key={qp.id}
                  className="quick-add-card"
                  onClick={() => void quickAdd(qp)}
                  title={`Add ${qp.name} — get a key at ${qp.keyUrl}`}
                >
                  <span className="quick-add-name">{qp.name}</span>
                  <span className="quick-add-blurb">{qp.blurb}</span>
                </button>
              ))}
            </div>
            <p className="hint">
              Each card adds the provider and prompts for a key. Don't have one yet?{" "}
              <button className="link-btn" onClick={() => setView("discover")}>Browse the full catalog</button>.
            </p>
          </div>
        )}
        {/* Already-added providers waiting for a key. */}
        {unkeyedProviders.length > 0 && (
          <div className="quick-add">
            <p className="hint">
              Add a key to one of these:{" "}
              {unkeyedProviders.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && " · "}
                  <button
                    className="link-btn"
                    onClick={async () => {
                      const key = await promptDialog(`Add ${p.name} key`, { placeholder: "API key" });
                      if (key && key.trim()) {
                        const s = structuredClone(useStore.getState().settings);
                        const target = s.providers.find((x) => x.id === p.id);
                        if (target) target.apiKey = key.trim();
                        await useStore.getState().saveSettings(s);
                      }
                    }}
                  >
                    {p.name}
                  </button>
                </span>
              ))}
            </p>
          </div>
        )}
        {remoteProviders.map((p) => {
          const editing = editProvider === p.id;
          const hasKey = p.apiKey.trim().length > 0;
          const localish = p.id === "ollama" || p.id === "lmstudio" || p.id === "llamacpp";
          const probe = probes[p.id];
          return (
            <div key={p.id} className="provider-card">
              <div className="provider-row">
                <span
                  className={`conn-dot ${probe?.state === "ok" ? "on" : probe?.state === "checking" ? "checking" : probe?.state === "error" ? "bad" : "unknown"}`}
                  aria-hidden="true"
                />
                <div className="grow">
                  <b>{p.name}</b>{" "}
                  <span className="hint">
                    {p.models.length} model{p.models.length === 1 ? "" : "s"} · {p.baseUrl}
                  </span>
                  <div className="hint">
                    {/* Three separate facts, previously collapsed into one line:
                        how it authenticates, whether it answered, and when. */}
                    {localish ? "Local server — no key needed" : hasKey ? "API key set" : "No API key set"}
                    {probe?.state === "checking" && <> · checking…</>}
                    {probe?.state === "ok" && (
                      <>
                        {" · "}
                        <span className="fit-gpu">
                          answered with {probe.count} model{probe.count === 1 ? "" : "s"}
                        </span>
                        {probe.error && <> · {probe.error}</>}
                      </>
                    )}
                    {probe?.state === "error" && (
                      <>
                        {" · "}
                        <span className="fit-no">{probe.error}</span>
                      </>
                    )}
                    {!probe && !localish && !hasKey && <> — add one to use it</>}
                  </div>
                </div>
                <button
                  className="btn small"
                  disabled={probe?.state === "checking"}
                  title="Ask the provider for its model list — checks the connection and refreshes the models below"
                  onClick={() => void checkProvider(p)}
                >
                  {probe?.state === "checking" ? "Checking…" : "Check"}
                </button>
                <button className="btn small" onClick={() => (editing ? setEditProvider(null) : openEdit(p.id))}>
                  {editing ? "Close" : "Edit"}
                </button>
                <button className="icon-btn" title="Remove provider" onClick={() => void removeProvider(p.id)}>
                  <IconX size={12} />
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
                  {/* Chat models first. The list is cut at 12, and a provider
                      whose speech and embedding models happen to sort earlier
                      would otherwise spend the whole preview on models a chat
                      cannot even send to. */}
                  {(() => {
                    const ordered = groupByModality(p.models).flatMap((g) =>
                      g.models.map((m) => ({ id: m, modality: g.modality })),
                    );
                    return (expanded[p.id] ? ordered : ordered.slice(0, 12)).map((entry) => {
                      const m = entry.id;
                      const inUse = current?.providerId === p.id && current?.model === m;
                      const usable = chatCapable(entry.modality);
                      return (
                        <button
                          key={m}
                          className={`model-chip${inUse ? " active" : ""}${usable ? "" : " other"}`}
                          title={
                            inUse
                              ? "This chat is using this model"
                              : usable
                                ? "Use this model in the current chat"
                                : `${MODALITY_LABEL[entry.modality]} model — a chat cannot send to this one`
                          }
                          onClick={() => useInChat(p.id, m)}
                        >
                          {m}
                          {entry.modality !== "text" && (
                            <span className="chip-tag">{MODALITY_TAG[entry.modality]}</span>
                          )}
                        </button>
                      );
                    });
                  })()}
                  {/* Was a dead "+N more" label. With OpenRouter or Ollama Cloud
                      that hid most of the list behind nothing at all. */}
                  {p.models.length > 12 && (
                    <button className="link-btn" onClick={() => setExpanded((e) => ({ ...e, [p.id]: !e[p.id] }))}>
                      {expanded[p.id] ? "Show fewer" : `+${p.models.length - 12} more`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section>
        <button className="link-btn settings-advanced-toggle" onClick={() => setShowColibri((v) => !v)}>
          {showColibri ? "Hide advanced" : "Advanced: Colibri (huge MoE models) ▾"}
        </button>
        {showColibri && (
          <>
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
          </>
        )}
      </section>

      <section>
        <h2>Local models (GGUF)</h2>
        <p className="hint">
          Run a model on your own machine. Already have Ollama, LM Studio, or llama.cpp running?
          Pull its models here:
        </p>
        <div className="provider-row" style={{ marginBottom: 10 }}>
          <button className="btn small" onClick={() => void importOllama()} title="List models from a running Ollama install and add them as chat providers">
            Import from Ollama
          </button>
          <button className="btn small" onClick={() => void importLmStudio()} title="List models from a running LM Studio server and add them as chat providers">
            Import from LM Studio
          </button>
          <button className="btn small" onClick={() => void importLlamaCpp()} title="List the model from a running llama.cpp llama-server (:8080) and add it as a chat provider">
            Import from llama.cpp
          </button>
        </div>
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
            <label className="check">
              <input type="checkbox" checked={mtp} onChange={(e) => setMtp(e.target.checked)} />
              Multi-token prediction — ~1.5–2x faster, no extra memory
            </label>
            {mtp && (
              <>
                <label>
                  Draft tokens{" "}
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={mtpDraft}
                    style={{ width: 60 }}
                    onChange={(e) => setMtpDraft(e.target.value)}
                  />
                  <span className="hint"> 2 for a dense model, 3 for MoE.</span>
                </label>
                <p className="hint">
                  Only works on a model built with MTP heads (its name usually says
                  “MTP”) and llama.cpp build 9200+. On any other model it does
                  nothing at all rather than failing, so if you see no speed-up,
                  that is why. The gain shows up on long replies, not short ones.
                </p>
              </>
            )}
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
          // The filename is where NVFP4/MXFP4 shows up on third-party builds.
          const caveat = hw ? fitCaveat(m.file, hw.gpu_name) : null;
          const loaded = status.running && status.model === m.relPath;
          return (
            <div key={m.relPath} className="provider-card">
              <div className="provider-row">
                <div className="grow">
                  <b>{m.file}</b>
                  <div className="hint">
                    {m.publisher}/{m.model} · {(m.sizeMB / 1024).toFixed(1)} GB
                    {fit && <span className={`fit fit-${fit}`}> · {FIT_LABEL[fit]}</span>}
                    {caveat && <span className={`fit fit-tight`}> · {caveat}</span>}
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
                  <IconX size={11} />
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
