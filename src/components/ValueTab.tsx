import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  countUnpriceable,
  EMPTY_CATALOG,
  isStale,
  loadCatalog,
  providerCounts,
  refreshAll,
  searchModels,
  type ModelQuery,
} from "../lib/pricing/catalog";
import {
  gpuMatches,
  hostingMatches,
  toGpuCandidate,
  toHostingCandidate,
  type GpuQuery,
  type HostingQuery,
} from "../lib/pricing/hosting";
import { currentFxRate, type FxRate } from "../lib/pricing/fx";
import { changesSince, historyDays, loadHistory, type PriceChange } from "../lib/pricing/history";
import { perMtok, usd } from "../lib/pricing/money";
import { PRESETS, rank, type Weights } from "../lib/pricing/score";
import { calculate, DEFAULT_WORKLOAD, savingsPct, type Workload } from "../lib/pricing/tco";
import type { PriceCatalog, PricedModel } from "../lib/pricing/types";
import { invalidatePrices, primeCostIndex } from "../lib/cost";
import { invalidateModelFacts, primeModelFacts } from "../lib/modelFacts";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";

type Section = "models" | "hosting" | "gpu";

const PRESET_LABELS: { id: keyof typeof PRESETS; label: string }[] = [
  { id: "bestValue", label: "Best value" },
  { id: "cheapest", label: "Cheapest" },
  { id: "bestQuality", label: "Best quality" },
  { id: "balanced", label: "Balanced" },
];

function ago(iso: string | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function gb(mb: number | undefined): string {
  if (mb === undefined) return "—";
  return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
}

export function ValueTab() {
  const { settings } = useStore();
  const [catalog, setCatalog] = useState<PriceCatalog>(EMPTY_CATALOG);
  const [section, setSection] = useState<Section>("models");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [preset, setPreset] = useState<keyof typeof PRESETS>("bestValue");
  const [onlyConfigured, setOnlyConfigured] = useState(false);
  const [requireTools, setRequireTools] = useState(false);
  const [requireFree, setRequireFree] = useState(false);
  const [requireVision, setRequireVision] = useState(false);
  const [minContext, setMinContext] = useState(0);
  const [showUnpriceable, setShowUnpriceable] = useState(false);
  const [workload, setWorkload] = useState<Workload>(DEFAULT_WORKLOAD);
  const [showWorkload, setShowWorkload] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [drops, setDrops] = useState<PriceChange[]>([]);
  const [days, setDays] = useState(0);
  const [fx, setFx] = useState<FxRate | null>(() => currentFxRate());
  const aborter = useRef<AbortController | null>(null);

  const refresh = async (existing?: PriceCatalog | null) => {
    setBusy(true);
    setError(null);
    aborter.current?.abort();
    const ac = new AbortController();
    aborter.current = ac;
    try {
      const { catalog: next, sources, fx: rate } = await refreshAll({
        signal: ac.signal,
        previous: existing ?? catalog,
      });
      setCatalog(next);
      if (rate) setFx(rate);
      // Exact per-message costs everywhere else in the app come from this index.
      primeCostIndex(next.models);
      invalidatePrices();
      // Same feed, different consumer: the modality and context-window facts the
      // chat path would otherwise have to infer from a model's name.
      primeModelFacts(next.models);
      invalidateModelFacts();
      const failed = sources.filter((s) => !s.ok);
      if (failed.length && failed.length === sources.length) {
        setError(`Every source failed. ${failed[0].error ?? ""}`);
      } else if (failed.length) {
        setError(`${failed.map((f) => f.source).join(", ")} unavailable — showing the rest.`);
      }
      const history = await loadHistory();
      setDays(historyDays(history));
      setDrops(changesSince(history, Date.now() - 30 * 86_400_000, { minPct: 2, limit: 8 }));
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await loadCatalog();
      if (cancelled) return;
      if (cached) {
        setCatalog(cached);
        primeCostIndex(cached.models);
        primeModelFacts(cached.models);
        const history = await loadHistory();
        if (cancelled) return;
        setDays(historyDays(history));
        setDrops(changesSince(history, Date.now() - 30 * 86_400_000, { minPct: 2, limit: 8 }));
      }
      // Paint from cache first, then refresh in the background if it's old.
      if (!cached || isStale(cached)) void refresh(cached);
    })();
    return () => {
      cancelled = true;
      aborter.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configuredSlugs = useMemo(
    () => settings.providers.map((p) => p.id),
    [settings.providers],
  );

  const weights: Weights = PRESETS[preset];

  const modelQuery: ModelQuery = useMemo(
    () => ({
      text,
      modality: "llm",
      requireTools: requireTools || undefined,
      requireVision: requireVision || undefined,
      requireFree: requireFree || undefined,
      minContext: minContext || undefined,
      excludeUnpriceable: !showUnpriceable,
      onlyConfigured: onlyConfigured ? configuredSlugs : undefined,
    }),
    [text, requireTools, requireVision, requireFree, minContext, showUnpriceable, onlyConfigured, configuredSlugs],
  );

  const modelRows = useMemo(
    () => (section === "models" ? searchModels(catalog, modelQuery, weights, 60) : []),
    [catalog, section, modelQuery, weights],
  );

  const hiddenCount = useMemo(
    () => (section === "models" ? countUnpriceable(catalog, modelQuery) : 0),
    [catalog, section, modelQuery],
  );

  const hostingRows = useMemo(() => {
    if (section !== "hosting") return [];
    const q: HostingQuery = { text };
    return rank(
      catalog.hosting.filter((o) => hostingMatches(o, q)).map((o) => toHostingCandidate(o, q)),
      weights,
      60,
    );
  }, [catalog, section, text, weights]);

  const gpuRows = useMemo(() => {
    if (section !== "gpu") return [];
    const q: GpuQuery = { text };
    return rank(
      catalog.gpu.filter((o) => gpuMatches(o, q)).map((o) => toGpuCandidate(o)),
      weights,
      60,
    );
  }, [catalog, section, text, weights]);

  const counts = useMemo(() => providerCounts(catalog), [catalog]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of catalog.models) m.set(x.id, `${x.name} · ${x.providerName}`);
    for (const x of catalog.hosting) m.set(x.id, `${x.name} · ${x.providerName}`);
    for (const x of catalog.gpu) m.set(x.id, `${x.name} · ${x.providerName}`);
    return m;
  }, [catalog]);

  const total =
    section === "models"
      ? catalog.models.filter((m) => m.modality === "llm").length
      : section === "hosting"
        ? catalog.hosting.length
        : catalog.gpu.length;

  return (
    <>
      <p className="hint">
        Live prices for AI models, hosting and GPU compute, fetched straight from the providers'
        own public price lists. No API key, no account — these are published numbers, and every row
        links to the page it came from.
      </p>

      <div className="provider-row">
        <input
          className="grow"
          value={text}
          placeholder={
            section === "models"
              ? "Search models, e.g. claude opus, qwen, gemini"
              : section === "hosting"
                ? "Search plans, e.g. nanode, high frequency"
                : "Search GPUs, e.g. a100, rtx"
          }
          onChange={(e) => setText(e.target.value)}
        />
        <select value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof PRESETS)}>
          {PRESET_LABELS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <p className="hint">
        {total.toLocaleString()} {section === "models" ? "models" : section === "hosting" ? "plans" : "GPU offers"}
        {" · "}
        {catalog.fetchedAt ? `as of ${ago(catalog.fetchedAt)}` : "not fetched yet"}
        {catalog.sources.length > 0 && (
          <>
            {" · "}
            {catalog.sources.map((s) => `${s.source} ${s.ok ? s.count : "failed"}`).join(", ")}
          </>
        )}
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="seg">
        {(["models", "hosting", "gpu"] as Section[]).map((s) => (
          <button
            key={s}
            className={`seg-btn ${section === s ? "active" : ""}`}
            onClick={() => setSection(s)}
          >
            {s === "models" ? "AI models" : s === "hosting" ? "Hosting" : "GPU"}
          </button>
        ))}
      </div>

      {section === "models" && (
        <>
          <div className="provider-row">
            <label className="hint">
              <input type="checkbox" checked={requireTools} onChange={(e) => setRequireTools(e.target.checked)} />{" "}
              Tool calling
            </label>
            <label className="hint">
              <input type="checkbox" checked={requireVision} onChange={(e) => setRequireVision(e.target.checked)} />{" "}
              Vision
            </label>
            <label className="hint" title="Only listings the feed explicitly marks free — :free variants and $0 tiers">
              <input type="checkbox" checked={requireFree} onChange={(e) => setRequireFree(e.target.checked)} />{" "}
              Free only
            </label>
            <label className="hint">
              <input
                type="checkbox"
                checked={onlyConfigured}
                onChange={(e) => setOnlyConfigured(e.target.checked)}
              />{" "}
              Only providers I've added
            </label>
            <select value={minContext} onChange={(e) => setMinContext(Number(e.target.value))}>
              <option value={0}>Any context</option>
              <option value={32_000}>32k+</option>
              <option value={128_000}>128k+</option>
              <option value={200_000}>200k+</option>
              <option value={1_000_000}>1M+</option>
            </select>
            <button className="link-btn" onClick={() => setShowWorkload((v) => !v)}>
              {showWorkload ? "Hide workload" : "Price my workload"}
            </button>
          </div>

          {showWorkload && (
            <div className="provider-card">
              <p className="hint">
                Sticker price is not the bill. Enter a monthly workload and each row shows what it
                would actually cost, including cache reads, cache writes and batch discounts.
              </p>
              <div className="provider-row">
                <label className="hint">
                  Input tokens/mo
                  <input
                    type="number"
                    value={workload.inputTokens}
                    onChange={(e) => setWorkload({ ...workload, inputTokens: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="hint">
                  Output tokens/mo
                  <input
                    type="number"
                    value={workload.outputTokens}
                    onChange={(e) => setWorkload({ ...workload, outputTokens: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="hint">
                  Requests/mo
                  <input
                    type="number"
                    value={workload.requests}
                    onChange={(e) => setWorkload({ ...workload, requests: Number(e.target.value) || 0 })}
                  />
                </label>
                <label className="hint">
                  Cache hit {Math.round(workload.cacheHitRate * 100)}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={workload.cacheHitRate * 100}
                    onChange={(e) => setWorkload({ ...workload, cacheHitRate: Number(e.target.value) / 100 })}
                  />
                </label>
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={workload.useBatch}
                    onChange={(e) => setWorkload({ ...workload, useBatch: e.target.checked })}
                  />{" "}
                  Batch
                </label>
              </div>
            </div>
          )}

          {hiddenCount > 0 && (
            <p className="hint">
              {hiddenCount.toLocaleString()} listing{hiddenCount === 1 ? "" : "s"} priced at $0 hidden —
              seat-licensed plans, or ones the feed leaves ambiguous. They would otherwise top every
              ranking while being unbuyable without the plan.{" "}
              <button className="link-btn" onClick={() => setShowUnpriceable(true)}>
                Show them
              </button>
            </p>
          )}
          {showUnpriceable && (
            <p className="hint">
              Including unverified $0 listings.{" "}
              <button className="link-btn" onClick={() => setShowUnpriceable(false)}>
                Hide again
              </button>
            </p>
          )}

          {modelRows.length === 0 && !busy && (
            <p className="hint">No models match. Try clearing the filters or refreshing.</p>
          )}

          {modelRows.map(({ candidate, score, explanation }) => {
            const m: PricedModel = candidate.model;
            const est = showWorkload ? calculate(m, workload) : null;
            const pct = est ? savingsPct(est) : undefined;
            return (
              <div key={m.id} className="provider-card">
                <div
                  className="provider-row"
                  style={{ cursor: "pointer" }}
                  onClick={() => setOpen(open === m.id ? null : m.id)}
                >
                  <div className="grow">
                    <b>{m.name}</b>
                    {m.pricing.model === "free" && <span className="free-badge">Free</span>}
                    {m.pricing.model === "subscription" && (
                      <span className="free-badge" title="Token price is $0 because a plan or seat grants access">
                        Plan
                      </span>
                    )}
                    {m.pricing.model === "unknown" && (
                      <span className="free-badge" title="Published at $0 with no way to tell whether that is a free tier or a seat licence">
                        $0 unverified
                      </span>
                    )}
                    {configuredSlugs.includes(m.providerSlug) && (
                      <span className="free-badge">Added</span>
                    )}
                    <div className="hint">
                      {m.providerName} · <code>{m.modelKey}</code>
                    </div>
                    <div className="hint">
                      in {perMtok(m.pricing.input)} · out {perMtok(m.pricing.output)}
                      {m.pricing.cacheRead !== undefined && <> · cached {perMtok(m.pricing.cacheRead)}</>}
                      {m.capabilities.contextWindow && (
                        <> · {(m.capabilities.contextWindow / 1000).toFixed(0)}k ctx</>
                      )}
                      {m.quality?.intelligence !== undefined && (
                        <> · quality {m.quality.intelligence}</>
                      )}
                    </div>
                    <div className="hint">{explanation}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {est ? (
                      <>
                        <b>{usd(est.monthlyCost)}</b>
                        <div className="hint">/mo for your workload</div>
                        {pct !== undefined && pct > 0 && (
                          <div className="hint">saves {pct.toFixed(0)}% vs uncached</div>
                        )}
                        {!est.feasible && <div className="hint">cannot run this workload</div>}
                      </>
                    ) : (
                      <>
                        <b>{perMtok(candidate.price)}</b>
                        <div className="hint">blended 3:1</div>
                      </>
                    )}
                    <div className="hint">score {score.toFixed(3)}</div>
                  </div>
                </div>

                {open === m.id && (
                  <div>
                    {est && (
                      <>
                        {est.lineItems.map((li) => (
                          <div key={li.label} className="provider-row">
                            <span className="grow hint">
                              {li.label} — {Math.round(li.quantity).toLocaleString()} {li.unit}
                              {li.note ? ` (${li.note})` : ""}
                            </span>
                            <span className="hint">{usd(li.cost)}</span>
                          </div>
                        ))}
                        {est.assumptions.map((a) => (
                          <div key={a} className="hint">
                            Assumption: {a}
                          </div>
                        ))}
                        {est.warnings.map((w) => (
                          <div key={w} className="hint">
                            Warning: {w}
                          </div>
                        ))}
                      </>
                    )}
                    <div className="provider-row">
                      <span className="grow hint">
                        {m.capabilities.supportsTools ? "tools · " : ""}
                        {m.capabilities.supportsVision ? "vision · " : ""}
                        {m.capabilities.supportsReasoning ? "reasoning · " : ""}
                        {m.capabilities.openWeights ? "open weights · " : ""}
                        from {m.provenance.source}, {ago(m.provenance.fetchedAt)}
                      </span>
                      {m.provenance.sourceUrl && (
                        <button
                          className="link-btn"
                          onClick={() => void openUrl(m.provenance.sourceUrl!)}
                        >
                          Source
                        </button>
                      )}
                      <button
                        className="link-btn"
                        onClick={() => {
                          void navigator.clipboard?.writeText(m.modelKey);
                          toast.success(`Copied ${m.modelKey}`);
                        }}
                      >
                        Copy model id
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {section === "hosting" && (
        <>
          {fx && (
            <p className="hint">
              European prices converted at €1 = ${fx.eurUsd.toFixed(4)}
              {fx.date ? ` (ECB, ${fx.date})` : ""}
              {fx.stale && " — cached rate, conversion is approximate"}
            </p>
          )}
          {hostingRows.length === 0 && !busy && (
            <p className="hint">
              No hosting plans loaded. Vultr and Scaleway publish no CORS headers, so they load only
              in the desktop app; Linode works everywhere.
            </p>
          )}
          {hostingRows.map(({ candidate, explanation }) => {
            const o = candidate.offer;
            return (
              <div key={o.id} className="provider-card">
                <div className="provider-row">
                  <div className="grow">
                    <b>{o.name}</b>
                    <div className="hint">
                      {o.providerName} · {o.vcpu ?? "—"} vCPU · {gb(o.ramMB)} RAM ·{" "}
                      {o.diskGB ? `${o.diskGB.toFixed(0)} GB disk` : "—"}
                      {o.transferGB ? ` · ${o.transferGB.toLocaleString()} GB transfer` : ""}
                      {o.regions?.length ? ` · ${o.regions.length} region${o.regions.length === 1 ? "" : "s"}` : ""}
                      {o.quotedCurrency && o.quotedCurrency !== "USD" && o.quotedAmount !== undefined
                        ? ` · quoted ${o.quotedAmount.toFixed(4)} ${o.quotedCurrency}/hr`
                        : ""}
                    </div>
                    <div className="hint">{explanation}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <b>{usd(o.effectiveMonthlyUsd ?? o.monthlyUsd)}</b>
                    <div className="hint">/month</div>
                    {o.hourlyUsd !== undefined && (
                      <div className="hint">{usd(o.hourlyUsd, { precise: true })}/hr</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {section === "gpu" && (
        <>
          {gpuRows.length === 0 && !busy && <p className="hint">No GPU offers loaded.</p>}
          {gpuRows.map(({ candidate, explanation }) => {
            const o = candidate.offer;
            return (
              <div key={o.id} className="provider-card">
                <div className="provider-row">
                  <div className="grow">
                    <b>{o.name}</b>
                    <div className="hint">
                      {o.providerName}
                      {o.gpuModel ? ` · ${o.gpuModel}` : ""}
                      {o.gpuCount ? ` ×${o.gpuCount}` : ""}
                      {o.vramGBPerGpu ? ` · ${o.vramGBPerGpu} GB VRAM` : ""}
                      {o.vcpu ? ` · ${o.vcpu} vCPU` : ""}
                    </div>
                    <div className="hint">{explanation}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <b>{usd(o.hourlyUsd, { precise: true })}</b>
                    <div className="hint">/hour</div>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      <section>
        <h2>Price changes</h2>
        {drops.length === 0 ? (
          <p className="hint">
            {days === 0
              ? "History starts now. Price changes appear here once this machine has seen a price move — it accrues locally from today, so there's nothing to show on a first run."
              : `No moves above 2% in the last 30 days. Watching ${days} day${days === 1 ? "" : "s"} of history.`}
          </p>
        ) : (
          <>
            <p className="hint">
              Observed on this machine over {days} day{days === 1 ? "" : "s"}.
            </p>
            {drops.map((d) => (
              <div key={d.id + d.at} className="provider-row">
                <span className="grow hint">{nameById.get(d.id) ?? d.id}</span>
                <span className="hint">
                  {d.kind === "new"
                    ? `new at ${usd(d.to)}`
                    : `${usd(d.from)} → ${usd(d.to)} (${d.pct! > 0 ? "+" : ""}${d.pct!.toFixed(1)}%)`}
                </span>
              </div>
            ))}
          </>
        )}
      </section>

      {section === "models" && counts.size > 0 && (
        <p className="hint">
          Across {counts.size.toLocaleString()} providers. Ranking sees price, quality, freshness and
          spec fit — and nothing else. There is no sponsored placement here because there is no field
          for it.
        </p>
      )}
    </>
  );
}
