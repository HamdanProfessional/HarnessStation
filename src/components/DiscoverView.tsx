import { lazy, Suspense, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CATALOG,
  CLOUD_CATEGORY,
  CLOUD_CATEGORY_ORDER,
  CLOUD_PROVIDERS,
  fitFor,
  fitCaveat,
  FIT_LABEL,
  parseHfUrl,
  resolveCatalog,
  type CatalogModel,
  type CloudProvider,
} from "../lib/catalog";
import { hfDownloadUrl, hfFiles, hfSearch, type HfFile, type HfRepo } from "../lib/gateway";
import { downloadFile, hwInfo, onDownloadProgress, type HwInfo } from "../lib/local";
import { listModels } from "../lib/providers";
import { useStore } from "../lib/store";
import { promptDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import { IconBolt, IconCloud, IconPencil, IconPlus } from "./icons";
import type { MediaEngine, MediaKind, MediaModel } from "../lib/types";

const ValueTab = lazy(() => import("./ValueTab").then((m) => ({ default: m.ValueTab })));

interface MediaPreset {
  id: string;
  name: string;
  by: string;
  blurb: string;
  engine: MediaEngine;
  kind: MediaKind;
  baseUrl: string;
  model: string;
  options?: string;
  needsKey: boolean;
  keyUrl?: string;
  hint?: string;
}

const MEDIA_CLOUD_PRESETS: MediaPreset[] = [
  {
    id: "openai-image",
    name: "OpenAI Images",
    by: "openai.com",
    blurb: "gpt-image-1 — high-quality text-to-image via the OpenAI API.",
    engine: "openai-image",
    kind: "image",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1",
    options: "1024x1024",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "replicate-flux-schnell",
    name: "Replicate — FLUX.1 [schnell]",
    by: "replicate.com",
    blurb: "Fast, high-quality open image model hosted on Replicate.",
    engine: "replicate",
    kind: "image",
    baseUrl: "https://api.replicate.com/v1",
    model: "black-forest-labs/flux-schnell",
    needsKey: true,
    keyUrl: "https://replicate.com/account/api-tokens",
    hint: "May require a specific version hash — check the model page on Replicate and paste it into the model field in Settings.",
  },
  {
    id: "openai-tts",
    name: "OpenAI TTS",
    by: "openai.com",
    blurb: "tts-1 — natural-sounding text-to-speech via the OpenAI API.",
    engine: "openai-speech",
    kind: "audio",
    baseUrl: "https://api.openai.com/v1",
    model: "tts-1",
    options: "alloy",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "replicate-video-minimax",
    name: "Replicate — Video (MiniMax)",
    by: "replicate.com",
    blurb: "minimax/video-01 — text/image-to-video hosted on Replicate.",
    engine: "replicate",
    kind: "video",
    baseUrl: "https://api.replicate.com/v1",
    model: "minimax/video-01",
    needsKey: true,
    keyUrl: "https://replicate.com/account/api-tokens",
  },
  {
    id: "replicate-hunyuan3d",
    name: "Replicate — Hunyuan3D (3D)",
    by: "replicate.com",
    blurb: "Text-to-3D mesh (.glb). Open-source Hunyuan3D via Replicate.",
    engine: "replicate",
    kind: "3d",
    baseUrl: "https://api.replicate.com/v1",
    model: "tencent/hunyuan3d-2",
    options: "",
    needsKey: true,
    keyUrl: "https://replicate.com/account/api-tokens",
  },
];

const MEDIA_LOCAL_PRESETS: MediaPreset[] = [
  {
    id: "a1111-local",
    name: "Stable Diffusion webui",
    by: "A1111 / Forge / SD.Next",
    blurb: "Connect a local Stable Diffusion webui for image generation.",
    engine: "a1111",
    kind: "image",
    baseUrl: "http://localhost:7860",
    model: "",
    options: "512x512",
    needsKey: false,
  },
  {
    id: "local-tts",
    name: "Local TTS",
    by: "openedai-speech / Kokoro (OpenAI-compatible)",
    blurb: "Connect a local OpenAI-compatible TTS server.",
    engine: "openai-speech",
    kind: "audio",
    baseUrl: "http://localhost:8000/v1",
    model: "tts-1",
    options: "alloy",
    needsKey: false,
  },
];

function CloudLogo({ p }: { p: CloudProvider }) {
  const [err, setErr] = useState(false);
  const domain = (() => {
    if (/^[\w-]+(\.[\w-]+)+$/.test(p.by)) return p.by;
    try {
      return new URL(p.baseUrl).host.replace(/^(api|dashscope-intl|studio|llm)\./, "");
    } catch {
      return p.by;
    }
  })();
  if (err) {
    return (
      <span className="cloud-logo">
        {p.id === "groq" || p.id === "cerebras" ? <IconBolt size={18} /> : <IconCloud size={18} />}
      </span>
    );
  }
  return (
    <span className="cloud-logo">
      <img
        className="cloud-logo-img"
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        onError={() => setErr(true)}
      />
    </span>
  );
}

interface DlState {
  received: number;
  total: number | null;
  done: boolean;
  error?: string;
}

export function DiscoverView() {
  const { setView, addCloudProvider, settings, saveSettings } = useStore();
  const [tab, setTab] = useState<"cloud" | "local" | "media" | "value">(() => {
    const t = sessionStorage.getItem("hs-discover-tab");
    sessionStorage.removeItem("hs-discover-tab");
    return t === "local" || t === "media" || t === "value" ? t : "cloud";
  });
  const [localMediaUrl, setLocalMediaUrl] = useState<Record<string, string>>(() =>
    Object.fromEntries(MEDIA_LOCAL_PRESETS.map((p) => [p.id, p.baseUrl])),
  );
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [quantSel, setQuantSel] = useState<Record<string, string>>({});
  const [hw, setHw] = useState<HwInfo | null>(null);
  const [downloads, setDownloads] = useState<Record<string, DlState>>({});
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<HfRepo[] | null>(null);
  const [openRepo, setOpenRepo] = useState<string | null>(null);
  const [repoFiles, setRepoFiles] = useState<Record<string, HfFile[]>>({});
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    void hwInfo().then(setHw);
    const un = onDownloadProgress((p) => {
      if (!p.id.startsWith("model-")) return;
      setDownloads((d) => ({
        ...d,
        [p.id]: { received: p.received, total: p.total, done: p.done },
      }));
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const start = (m: CatalogModel) => {
    const id = `model-${m.file}`;
    setDownloads((d) => ({ ...d, [id]: { received: 0, total: null, done: false } }));
    const dest = `models/${m.publisher}/${m.model}/${m.file}`;
    downloadFile(m.url, dest, id).catch((e) =>
      setDownloads((d) => ({
        ...d,
        [id]: { ...d[id], error: (e as Error).message || String(e) },
      })),
    );
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setOpenRepo(null);
    try {
      setResults(await hfSearch(query.trim()));
    } catch (e) {
      setSearchError((e as Error).message || String(e));
    } finally {
      setSearching(false);
    }
  };

  const toggleRepo = async (repoId: string) => {
    if (openRepo === repoId) {
      setOpenRepo(null);
      return;
    }
    setOpenRepo(repoId);
    if (!repoFiles[repoId]) {
      try {
        const files = await hfFiles(repoId);
        setRepoFiles((r) => ({ ...r, [repoId]: files }));
      } catch (e) {
        setSearchError((e as Error).message || String(e));
      }
    }
  };

  const addCloud = async (p: CloudProvider) => {
    setCloudNotice(null);
    const already = settings.providers.find((x) => x.id === p.id);
    await addCloudProvider({
      id: p.id,
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      models: p.models,
    });
    const existingKey = already?.apiKey ?? "";
    const key = await promptDialog(`Add ${p.name}`, {
      message: `Paste your ${p.name} API key (get one at ${p.keyUrl}). Leave blank to set it later in Settings.`,
      defaultValue: existingKey,
      placeholder: "API key",
    });
    if (key && key.trim()) {
      const s = structuredClone(useStore.getState().settings);
      const prov = s.providers.find((x) => x.id === p.id);
      if (prov) prov.apiKey = key.trim();
      await saveSettings(s);
    }
    // pull the FULL live model list from the provider's API (all models the token can access)
    setCloudNotice(`${p.name} added — fetching models from the API...`);
    try {
      const cur = useStore.getState().settings.providers.find((x) => x.id === p.id);
      if (cur) {
        const live = await listModels(cur);
        if (live.length) {
          const s = structuredClone(useStore.getState().settings);
          const prov = s.providers.find((x) => x.id === p.id);
          if (prov) prov.models = live;
          await saveSettings(s);
          setCloudNotice(`${p.name} added — ${live.length} models loaded from the API.`);
          toast.success(`${p.name}: ${live.length} models`);
          return;
        }
      }
    } catch {
      /* API listing not available — keep the curated list, user can refresh in a chat */
    }
    setCloudNotice(`${p.name} added — select it as the provider in any chat (use "refresh" to list models).`);
    toast.success(`${p.name} added`);
  };

  const cloudAdded = (id: string) => settings.providers.some((p) => p.id === id);

  const addMediaPreset = async (preset: MediaPreset, baseUrlOverride?: string) => {
    const s = structuredClone(useStore.getState().settings);
    const model: MediaModel = {
      id: `media-${Date.now()}`,
      name: preset.name,
      kind: preset.kind,
      engine: preset.engine,
      baseUrl: baseUrlOverride?.trim() || preset.baseUrl,
      apiKey: preset.needsKey ? "" : undefined,
      model: preset.model,
      options: preset.options,
    };
    s.mediaModels = [...(s.mediaModels ?? []), model];
    await saveSettings(s);
    if (preset.needsKey) {
      toast.success(`${preset.name} added — paste your API key in Settings.`);
    } else {
      toast.success(`${preset.name} added.`);
    }
  };

  const fromUrl = () => {
    setUrlError(null);
    const parsed = parseHfUrl(url);
    if (!parsed) {
      setUrlError("Paste a direct Hugging Face .gguf link (.../resolve/main/file.gguf).");
      return;
    }
    setUrl("");
    start(parsed);
  };

  const fitSpan = (sizeMB: number, name?: string) => {
    if (!hw || !sizeMB) return null;
    const fit = fitFor(sizeMB, hw.total_ram_mb, hw.vram_mb);
    // "Fits" is only half the answer for an FP4 build — see fitCaveat.
    const caveat = name ? fitCaveat(name, hw.gpu_name) : null;
    return (
      <>
        <span className={`fit fit-${fit}`}> · {FIT_LABEL[fit]}</span>
        {caveat && <span className="fit fit-tight"> · {caveat}</span>}
      </>
    );
  };

  const dlControl = (m: CatalogModel) => {
    const id = `model-${m.file}`;
    const dl = downloads[id];
    const pct = dl?.total ? Math.round((dl.received / dl.total) * 100) : null;
    if (dl?.done)
      return (
        <button className="btn" onClick={() => setView("models")}>
          Downloaded — open Models
        </button>
      );
    if (dl && !dl.error)
      return (
        <span className="hint">
          {pct !== null ? `${pct}%` : `${(dl.received / 1024 / 1024).toFixed(0)} MB`}
        </span>
      );
    return (
      <button className="btn primary small" onClick={() => start(m)}>
        Download
      </button>
    );
  };

  const dlBar = (file: string) => {
    const dl = downloads[`model-${file}`];
    if (!dl || dl.done || dl.error) return dl?.error ? <div className="error-banner">{dl.error}</div> : null;
    return (
      <progress className="dl-bar" value={dl.total ? dl.received : undefined} max={dl.total ?? undefined} />
    );
  };

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Discover</h1>
        <button className="btn" onClick={() => setView("models")}>
          My Models
        </button>
      </div>

      <div className="seg">
        <button className={`seg-btn ${tab === "cloud" ? "active" : ""}`} onClick={() => setTab("cloud")}>
          Cloud providers
        </button>
        <button className={`seg-btn ${tab === "local" ? "active" : ""}`} onClick={() => setTab("local")}>
          Local models
        </button>
        <button className={`seg-btn ${tab === "media" ? "active" : ""}`} onClick={() => setTab("media")}>
          Media generation
        </button>
        <button className={`seg-btn ${tab === "value" ? "active" : ""}`} onClick={() => setTab("value")}>
          Value
        </button>
      </div>

      {/* Lazily loaded: the price catalog pulls a few MB of JSON, and nobody
          should pay for that just by opening Discover to add a provider. */}
      {tab === "value" && (
        <Suspense fallback={<p className="hint">Loading price data...</p>}>
          <ValueTab />
        </Suspense>
      )}

      {tab === "cloud" && (
        <>
          <p className="hint">
            Connect a hosted provider — many offer a free tier. Adding one registers it as a chat
            provider; paste an API key when prompted or set it later in Settings.
          </p>
          {cloudNotice && <p className="hint">{cloudNotice}</p>}
          {CLOUD_CATEGORY_ORDER.map((cat) => {
            const inCat = CLOUD_PROVIDERS.filter((p) => (CLOUD_CATEGORY[p.id] ?? "Frontier APIs") === cat);
            if (!inCat.length) return null;
            return (
              <section key={cat}>
                <h2>{cat}</h2>
                <div className="card-grid">
                  {inCat.map((p) => {
                    const added = cloudAdded(p.id);
                    return (
                      <div key={p.id} className="cloud-card">
                  <div className="cloud-card-head">
                    <CloudLogo p={p} />
                    <div className="grow">
                      <div className="cloud-name">
                        {p.name}
                        {p.free && <span className="free-badge">Free tier</span>}
                      </div>
                      <div className="cloud-by">{p.by}</div>
                    </div>
                    {added ? (
                      <button
                        className="cloud-edit"
                        title="Edit this provider in My Models"
                        onClick={() => setView("models")}
                      >
                        <IconPencil size={14} /> Edit
                      </button>
                    ) : (
                      <button className="cloud-add" title="Add provider" onClick={() => void addCloud(p)}>
                        <IconPlus size={16} />
                      </button>
                    )}
                  </div>
                  <div className="cloud-blurb">{p.blurb}</div>
                  <div className="cloud-foot">
                    <span className="hint">{p.models.length} models</span>
                    <button className="link-btn" onClick={() => void openUrl(p.keyUrl)}>
                      Get API key
                    </button>
                  </div>
                </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </>
      )}

      {tab === "local" && (
        <>
      <section>
        <h2>Search Hugging Face</h2>
        <div className="provider-row">
          <input
            className="grow"
            value={query}
            placeholder="Search GGUF models, e.g. qwen 4b instruct"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
          <button className="btn primary" disabled={searching} onClick={() => void search()}>
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        {searchError && <div className="error-banner">{searchError}</div>}
        {results?.length === 0 && <p className="hint">No GGUF repositories found.</p>}
        {results?.map((r) => (
          <div key={r.id} className="provider-card">
            <div className="provider-row" style={{ cursor: "pointer" }} onClick={() => void toggleRepo(r.id)}>
              <div className="grow">
                <b>{r.id}</b>
                <div className="hint">
                  {r.downloads.toLocaleString()} downloads · {r.likes} likes
                </div>
              </div>
              <span className="hint">{openRepo === r.id ? "Hide files" : "Show files"}</span>
            </div>
            {openRepo === r.id && (
              <div>
                {!repoFiles[r.id] && <p className="hint">Loading file list...</p>}
                {repoFiles[r.id]?.length === 0 && <p className="hint">No .gguf files in this repo.</p>}
                {repoFiles[r.id]?.map((f) => {
                  const [publisher, model] = r.id.split("/");
                  const cm: CatalogModel = {
                    publisher,
                    model,
                    file: f.path.split("/").pop()!,
                    url: hfDownloadUrl(r.id, f.path),
                    sizeMB: f.sizeMB,
                    quant: "",
                    blurb: "",
                  };
                  return (
                    <div key={f.path} className="provider-row hf-file-row">
                      <div className="grow">
                        {f.path}
                        <span className="hint"> · {(f.sizeMB / 1024).toFixed(1)} GB</span>
                        {fitSpan(f.sizeMB, f.path)}
                      </div>
                      {dlControl(cm)}
                      {dlBar(cm.file)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2>Download from URL</h2>
        <div className="provider-row">
          <input
            className="grow"
            value={url}
            placeholder="https://huggingface.co/<user>/<repo>/resolve/main/<file>.gguf"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fromUrl()}
          />
          <button className="btn primary" onClick={fromUrl} disabled={!url.trim()}>
            Download
          </button>
        </div>
        {urlError && <div className="error-banner">{urlError}</div>}
      </section>

      <section>
        <h2>Staff picks</h2>
        <p className="hint">Pick a quantization — lower (Q4) is smaller/faster, higher (Q6/Q8) is more accurate.</p>
        {CATALOG.map((e) => {
          const quant = quantSel[e.repo] ?? e.defaultQuant ?? e.quants[0].q;
          const m = resolveCatalog(e, quant);
          return (
            <div key={e.repo} className="provider-card">
              <div className="provider-row">
                <div className="grow">
                  <b>{e.displayName}</b> <span className="hint">({e.params})</span>
                  <div className="hint">
                    {e.publisher}/{e.repo} · {(m.sizeMB / 1024).toFixed(1)} GB
                    {fitSpan(m.sizeMB, m.file)}
                  </div>
                  <div className="hint">{e.blurb}</div>
                </div>
                <select
                  value={quant}
                  onChange={(ev) => setQuantSel((s) => ({ ...s, [e.repo]: ev.target.value }))}
                >
                  {e.quants.map((qq) => (
                    <option key={qq.q} value={qq.q}>
                      {qq.q} · {(qq.sizeMB / 1024).toFixed(1)} GB
                    </option>
                  ))}
                </select>
                {dlControl(m)}
              </div>
              {dlBar(m.file)}
            </div>
          );
        })}
      </section>
        </>
      )}

      {tab === "media" && (
        <>
          <p className="hint">
            Set up image, voice, and video generation models. These power the generate_image /
            generate_speech / generate_video chat tools — they run through hosted APIs or local
            engines like ComfyUI/A1111 or a local TTS server, not through GGUF/llama.cpp.
          </p>
          <p className="hint">
            {(settings.mediaModels?.length ?? 0) === 0
              ? "No media models configured yet."
              : `${settings.mediaModels!.length} media model${settings.mediaModels!.length === 1 ? "" : "s"} configured: ${settings
                  .mediaModels!.map((m) => m.name)
                  .join(", ")}`}
            {"  "}
            <button className="link-btn" onClick={() => setView("settings")}>
              Manage in Settings
            </button>
          </p>

          <section>
            <h2>Media generation (image · voice · video)</h2>
            <div className="card-grid">
              {MEDIA_CLOUD_PRESETS.map((p) => (
                <div key={p.id} className="cloud-card">
                  <div className="cloud-card-head">
                    <span className="cloud-logo">
                      <IconCloud size={18} />
                    </span>
                    <div className="grow">
                      <div className="cloud-name">{p.name}</div>
                      <div className="cloud-by">{p.by}</div>
                    </div>
                    <button className="cloud-add" title="Add" onClick={() => void addMediaPreset(p)}>
                      <IconPlus size={16} />
                    </button>
                  </div>
                  <div className="cloud-blurb">{p.blurb}</div>
                  {p.hint && <div className="hint">{p.hint}</div>}
                  <div className="cloud-foot">
                    <span className="hint">{p.kind}</span>
                    {p.needsKey && p.keyUrl && (
                      <button className="link-btn" onClick={() => void openUrl(p.keyUrl!)}>
                        Get API key
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2>Connect a local engine</h2>
            <p className="hint">
              No API key needed — point HarnessStation at a generation server running on your
              machine or network.
            </p>
            <div className="card-grid">
              {MEDIA_LOCAL_PRESETS.map((p) => (
                <div key={p.id} className="cloud-card">
                  <div className="cloud-card-head">
                    <span className="cloud-logo">
                      <IconBolt size={18} />
                    </span>
                    <div className="grow">
                      <div className="cloud-name">{p.name}</div>
                      <div className="cloud-by">{p.by}</div>
                    </div>
                    <button
                      className="cloud-add"
                      title="Add"
                      onClick={() => void addMediaPreset(p, localMediaUrl[p.id])}
                    >
                      <IconPlus size={16} />
                    </button>
                  </div>
                  <div className="cloud-blurb">{p.blurb}</div>
                  <div className="provider-row">
                    <input
                      className="grow"
                      value={localMediaUrl[p.id] ?? p.baseUrl}
                      placeholder={p.baseUrl}
                      onChange={(e) => setLocalMediaUrl((u) => ({ ...u, [p.id]: e.target.value }))}
                    />
                  </div>
                  <div className="cloud-foot">
                    <span className="hint">{p.kind}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
