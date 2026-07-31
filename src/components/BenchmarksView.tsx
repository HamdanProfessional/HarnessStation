import { useEffect, useMemo, useState } from "react";
import { fetchBenchmarks, type BenchmarkModel } from "../lib/gateway";
import { useStore } from "../lib/store";

const CACHE_KEY = "hs-benchmarks-v1";
const CACHE_TTL = 24 * 60 * 60 * 1000;

type SortKey = "intelligence" | "speed" | "blended" | "value";
type Modality = "text" | "image" | "video" | "voice" | "3d";

interface Row extends BenchmarkModel {
  blended: number | null; // $/1M, 3:1 input:output blend
  value: number | null; // intelligence per blended $
  available: boolean; // matches a configured provider's model
}

interface CuratedModel {
  name: string;
  provider: string;
  strengths: string;
  notes: string;
  local?: boolean;
}

const CURATED_LEADERBOARDS: Record<Exclude<Modality, "text">, CuratedModel[]> = {
  image: [
    { name: "GPT Image 2", provider: "OpenAI", strengths: "#1 on blind-vote arenas; best complex-prompt adherence", notes: "Top quality; slower (minutes/image)" },
    { name: "Nano Banana Pro (Gemini 3.1 Flash Image)", provider: "Google", strengths: "Photorealism + editing, very fast", notes: "" },
    { name: "GPT Image 1.5", provider: "OpenAI", strengths: "Strong all-round, faster than GPT Image 2", notes: "" },
    { name: "FLUX.2 [max]", provider: "Black Forest Labs", strengths: "Open-weight leader; self-hostable", notes: "Best open/enterprise tier", local: true },
    { name: "Midjourney V8", provider: "Midjourney", strengths: "Best aesthetics / artistic look", notes: "" },
    { name: "Imagen 4", provider: "Google", strengths: "Photorealism in a cloud stack", notes: "" },
    { name: "Seedream 4.5", provider: "ByteDance", strengths: "Very fast, high quality", notes: "" },
    { name: "Stable Diffusion 3.5", provider: "Stability AI", strengths: "Open weights, fully local", notes: "", local: true },
  ],
  video: [
    { name: "Seedance 2.0", provider: "ByteDance", strengths: "#1 on Artificial Analysis; consistent character motion", notes: "" },
    { name: "HappyHorse-1.0", provider: "Alibaba", strengths: "Top-2 overall; strong prompt adherence", notes: "" },
    { name: "Veo 3.1", provider: "Google DeepMind", strengths: "Cinematic + native 48kHz audio & dialogue", notes: "" },
    { name: "Kling 3.0", provider: "Kuaishou", strengths: "Native 4K/60fps, 15s clips, multilingual lip-sync", notes: "" },
    { name: "Runway Gen-4", provider: "Runway", strengths: "Fast, controllable editing workflow", notes: "" },
    { name: "Hailuo 02", provider: "MiniMax", strengths: "Budget-friendly, solid quality", notes: "" },
    { name: "Luma Dream Machine", provider: "Luma", strengths: "Fast image-to-video", notes: "Sora 2 was deprecated in 2026." },
  ],
  "3d": [
    { name: "Tripo AI", provider: "Tripo", strengths: "Fastest; clean low-poly topology in seconds; game-engine ready", notes: "" },
    { name: "Rodin (Hyper3D)", provider: "Deemos", strengths: "Best hyper-realistic characters/humans", notes: "" },
    { name: "Meshy AI", provider: "Meshy", strengths: "Best all-round; text/image-to-3D + AI texturing", notes: "" },
    { name: "Hunyuan3D", provider: "Tencent", strengths: "Best open-source; high-fidelity geometry", notes: "", local: true },
    { name: "TRELLIS", provider: "Microsoft", strengths: "Open-source structured 3D", notes: "", local: true },
    { name: "3D AI Studio", provider: "3D AI Studio", strengths: "Full workflow: text/image-to-3D, texture, remesh", notes: "" },
    { name: "Zoo Text-to-CAD", provider: "Zoo", strengths: "Parametric CAD from text (engineering)", notes: "" },
  ],
  voice: [
    { name: "ElevenLabs v3", provider: "ElevenLabs", strengths: "Emotional range, expressive delivery, voice cloning", notes: "Usage-based credits" },
    { name: "gpt-4o-mini-tts", provider: "OpenAI", strengths: "Steerable tone/style via prompt, low latency", notes: "~$0.015/min via API" },
    { name: "Octave", provider: "Hume AI", strengths: "Emotion-aware, context-conditioned speech", notes: "API, usage-based" },
    { name: "PlayHT 3.0", provider: "PlayHT", strengths: "Real-time streaming, low-latency conversational TTS", notes: "Free tier + paid plans" },
    { name: "Sonic", provider: "Cartesia", strengths: "Ultra-low latency, voice agents/telephony", notes: "API, usage-based" },
    { name: "Aura", provider: "Deepgram", strengths: "Fast, cheap, reliable for voice agents", notes: "~$0.015/1k chars" },
    { name: "Kokoro", provider: "Open weights (hexgrad)", strengths: "Lightweight, decent quality for its size", notes: "Local-capable · runs offline, no API cost", local: true },
  ],
};

const MODALITY_LABELS: Record<Modality, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  voice: "Voice",
  "3d": "3D",
};

function CuratedTable({ modality }: { modality: Exclude<Modality, "text"> }) {
  const models = CURATED_LEADERBOARDS[modality];
  return (
    <>
      <p className="hint" style={{ marginTop: 12 }}>
        Curated editorial ranking (best-first) — there is no live benchmark API for {MODALITY_LABELS[modality].toLowerCase()} generation models yet, so this list is maintained by hand and may lag the newest releases.
      </p>
      <table className="bench-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Model</th>
            <th>Provider</th>
            <th>Strengths</th>
            <th>Notes / Pricing</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, i) => (
            <tr key={m.name}>
              <td>{i + 1}</td>
              <td>
                {m.name}
                {m.local && (
                  <span className="bench-badge" title="Can run locally / open weights">
                    local
                  </span>
                )}
              </td>
              <td className="hint">{m.provider}</td>
              <td>{m.strengths}</td>
              <td className="hint">{m.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function BenchmarksView() {
  const { setView, settings } = useStore();
  const [modality, setModality] = useState<Modality>("text");
  const [raw, setRaw] = useState<BenchmarkModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [creator, setCreator] = useState("All");
  const [sort, setSort] = useState<SortKey>("intelligence");
  const [availOnly, setAvailOnly] = useState(false);

  const load = async (force = false) => {
    setError(null);
    if (!force) {
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
        if (cached && Date.now() - cached.at < CACHE_TTL) {
          setRaw(cached.rows);
          setUpdatedAt(cached.at);
          return;
        }
      } catch {
        /* ignore */
      }
    }
    setLoading(true);
    try {
      const data = await fetchBenchmarks();
      const rows = data.filter((m) => m.intelligence !== null);
      const at = Date.now();
      setRaw(rows);
      setUpdatedAt(at);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at, rows }));
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // set of normalized model names the user can ACTUALLY run:
  // only from providers with an API key set, or free local providers (localhost).
  const ownedNames = useMemo(() => {
    const s = new Set<string>();
    const usable = settings.providers.filter(
      (p) => p.apiKey.trim() !== "" || /localhost|127\.0\.0\.1/.test(p.baseUrl),
    );
    for (const p of usable) for (const m of p.models) s.add(normalize(m));
    return s;
  }, [settings.providers]);

  const rows: Row[] = useMemo(() => {
    if (!raw) return [];
    return raw.map((m) => {
      const blended =
        m.priceIn !== null && m.priceOut !== null ? (m.priceIn * 3 + m.priceOut) / 4 : null;
      const value = blended && blended > 0 && m.intelligence !== null ? m.intelligence / blended : null;
      const nn = normalize(m.name);
      const available = [...ownedNames].some((o) => o.includes(nn) || nn.includes(o));
      return { ...m, blended, value, available };
    });
  }, [raw, ownedNames]);

  const creators = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) if (r.creator) c.set(r.creator, (c.get(r.creator) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 10);
  }, [rows]);

  const maxInt = Math.max(1, ...rows.map((r) => r.intelligence ?? 0));

  const q = query.toLowerCase();
  const filtered = rows
    .filter((r) => (creator === "All" || r.creator === creator))
    .filter((r) => (!availOnly || r.available))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.creator.toLowerCase().includes(q))
    .sort((a, b) => {
      const get = (r: Row) =>
        sort === "intelligence" ? r.intelligence ?? -1 : sort === "speed" ? r.speed ?? -1 : sort === "value" ? r.value ?? -1 : -(r.blended ?? 1e9);
      return get(b) - get(a);
    });

  const podium = [...rows].sort((a, b) => (b.intelligence ?? 0) - (a.intelligence ?? 0)).slice(0, 3);
  const bestValue = [...rows].filter((r) => r.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
  const fastest = [...rows].filter((r) => r.speed !== null).sort((a, b) => (b.speed ?? 0) - (a.speed ?? 0))[0];

  const th = (key: SortKey, label: string) => (
    <th className="bench-th-sort" onClick={() => setSort(key)}>
      {label} {sort === key && <span className="bench-sort-mark">▾</span>}
    </th>
  );

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Benchmarks</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {modality === "text" && updatedAt && (
            <span className="hint">updated {new Date(updatedAt).toLocaleDateString()}</span>
          )}
          {modality === "text" && (
            <button className="btn small" disabled={loading} onClick={() => void load(true)}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          )}
        </div>
      </div>
      <p className="hint">
        {modality === "text"
          ? "Model intelligence, speed, and pricing from Artificial Analysis. Cached 24h."
          : "Curated leaderboards for generation models — pick the best model for the job."}
      </p>

      <div className="seg">
        {(Object.keys(MODALITY_LABELS) as Modality[]).map((m) => (
          <button key={m} className={`seg-btn ${modality === m ? "active" : ""}`} onClick={() => setModality(m)}>
            {MODALITY_LABELS[m]}
          </button>
        ))}
      </div>

      {modality !== "text" && <CuratedTable modality={modality} />}

      {modality === "text" && (
        <>
      {error && (
        <div className="error-banner">
          {error}{" "}
          <button className="link-btn" onClick={() => setView("settings")}>
            add an API key in Settings
          </button>
        </div>
      )}

      {loading && !rows.length && <p className="hint">Loading leaderboard…</p>}

      {rows.length > 0 && (
        <>
          {/* highlight cards */}
          <div className="bench-highlights">
            {podium.map((r, i) => (
              <div key={r.name} className={`bench-hi rank-${i + 1}`}>
                <div className="bench-hi-rank">{["🥇 Smartest", "🥈 #2", "🥉 #3"][i]}</div>
                <div className="bench-hi-name">{r.name}</div>
                <div className="bench-hi-sub">{r.creator} · {r.intelligence?.toFixed(1)} intelligence</div>
              </div>
            ))}
            {bestValue && (
              <div className="bench-hi accent">
                <div className="bench-hi-rank">Best value</div>
                <div className="bench-hi-name">{bestValue.name}</div>
                <div className="bench-hi-sub">{bestValue.creator} · ${bestValue.blended?.toFixed(2)}/1M</div>
              </div>
            )}
            {fastest && (
              <div className="bench-hi accent">
                <div className="bench-hi-rank">Fastest</div>
                <div className="bench-hi-name">{fastest.name}</div>
                <div className="bench-hi-sub">{fastest.speed?.toFixed(0)} tok/s</div>
              </div>
            )}
          </div>

          {/* controls */}
          <div className="bench-controls">
            <input className="search" placeholder="Filter models…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <select value={creator} onChange={(e) => setCreator(e.target.value)}>
              <option value="All">All creators</option>
              {creators.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={availOnly} onChange={(e) => setAvailOnly(e.target.checked)} />
              Only models I can run
            </label>
          </div>

          <table className="bench-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>Creator</th>
                {th("intelligence", "Intelligence")}
                {th("speed", "Speed")}
                {th("blended", "$/1M")}
                {th("value", "Value")}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 120).map((r, i) => (
                <tr key={`${r.name}-${i}`} className={r.available ? "bench-owned" : ""}>
                  <td>{i + 1}</td>
                  <td>
                    {r.name}
                    {r.available && <span className="bench-badge" title="Available via a provider you've added">have</span>}
                  </td>
                  <td className="hint">{r.creator}</td>
                  <td>
                    <div className="bench-bar-wrap">
                      <div className="bench-bar" style={{ width: `${((r.intelligence ?? 0) / maxInt) * 100}%` }} />
                      <span>{r.intelligence?.toFixed(1)}</span>
                    </div>
                  </td>
                  <td>{r.speed?.toFixed(0) ?? "-"}</td>
                  <td>{r.blended !== null ? `$${r.blended.toFixed(2)}` : "-"}</td>
                  <td>{r.value !== null ? r.value.toFixed(1) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 8 }}>
            Value = intelligence per blended $/1M tokens (3:1 input:output). Click a column header to sort.
          </p>
        </>
      )}
        </>
      )}
    </main>
  );
}
