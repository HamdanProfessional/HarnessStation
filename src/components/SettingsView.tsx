import { useEffect, useRef, useState } from "react";
import { confirmDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import * as storage from "../lib/storage";
import { checkForUpdate, installUpdate, type UpdateInfo } from "../lib/updater";
import { DevicesPanel } from "./DevicesPanel";
import { SecretsPanel } from "./SecretsPanel";
import { HooksPanel } from "./HooksPanel";
import { ChannelsPanel } from "./ChannelsPanel";
import { WebLlmCard } from "./WebLlmCard";
import { useStore } from "../lib/store";
import { useModal } from "../lib/useModal";
import { AvatarGallery } from "./AvatarGallery";
import { invalidateNeuralVoice, speakNow } from "../lib/tts";
import { listSystemVoices, type SysVoice } from "../lib/sysvoice";
import { onSpendChange, totals, type SpendTotals } from "../lib/budget";
import { testRewrite, type RewriteTestResult } from "../lib/speechRewrite";
import { formatCost } from "../lib/cost";
import { hasBuiltInGateway } from "../lib/gateway";
import { PIPER_VOICES, DEFAULT_PIPER_VOICE, piperReady, piperVoice } from "../lib/piper";
import { KOKORO_VOICES, DEFAULT_KOKORO_VOICE, kokoroVoice } from "../lib/kokoro";
import { SPEECH_ENGINES, engineInfo, type SpeechEngine } from "../lib/speechProviders";
import { listMicDevices, micLevel, startRecording, type Recorder } from "../lib/audio";
import { STT_MODELS, DEFAULT_STT } from "../lib/whisper";
import type {
  MediaEngine,
  MediaKind,
  MediaModel,
  MemoryEntry,
  Provider,
  Settings,
} from "../lib/types";

/**
 * Settings is long; these split it into panels rather than one endless scroll.
 *
 * The keywords exist so the search box can find a setting by the word someone
 * actually has in mind — nobody looks for "barge-in" under "Voice", they type
 * "interrupt".
 */
const TABS = [
  {
    id: "general",
    label: "General",
    blurb: "Instructions, conversation, theme",
    keywords: "system prompt instructions theme dark light conversation compact autotitle tray background",
  },
  {
    id: "providers",
    label: "Providers",
    blurb: "Models, keys, embeddings",
    keywords: "api key openai anthropic ollama local model endpoint base url embeddings gateway benchmarks",
  },
  {
    id: "media",
    label: "Media models",
    blurb: "Image, audio, video, 3D",
    keywords: "image audio video 3d generate replicate stable diffusion speech",
  },
  {
    id: "voice",
    label: "Voice",
    blurb: "Avatar, speech, microphone",
    keywords: "avatar speech tts stt whisper microphone mic kokoro piper elevenlabs interrupt barge wake word language vrm",
  },
  {
    id: "memory",
    label: "Memory",
    blurb: "What the app remembers",
    keywords: "memory facts recall forget passive context window budget share",
  },
  {
    id: "devices",
    label: "Devices",
    blurb: "Pair your other machines",
    keywords: "mesh lan network pair peer share remote device",
  },
  {
    id: "secrets",
    label: "Secrets",
    blurb: "API keys the model uses but can't read",
    keywords: "secret api key token credential vault password cloudflare github stripe openai redact placeholder",
  },
  {
    id: "hooks",
    label: "Hooks & guardrails",
    blurb: "Tool policies and event webhooks",
    keywords: "guardrail confirm block deny allow tool policy webhook hook slack event turn error notify alert automation",
  },
  {
    id: "channels",
    label: "Channels",
    blurb: "Reach your agent from Telegram & Discord",
    keywords: "telegram discord channel bot message chat gateway messaging platform reach mobile",
  },
  { id: "usage", label: "Usage", blurb: "Spend caps and totals", keywords: "cost spend budget cap daily monthly tokens price" },
  {
    id: "data",
    label: "Data & updates",
    blurb: "Storage, export, version",
    keywords: "data folder export import backup update version about reset",
  },
] as const;

type Tab = (typeof TABS)[number]["id"];

const TAB_KEY = "hs-settings-tab";

const MEDIA_ENGINES: { value: MediaEngine; label: string; kind: MediaKind }[] = [
  { value: "openai-image", label: "OpenAI-compatible image (cloud/local)", kind: "image" },
  { value: "a1111", label: "Stable Diffusion webui (A1111/Forge, local)", kind: "image" },
  { value: "openai-speech", label: "OpenAI-compatible speech / local TTS", kind: "audio" },
  { value: "replicate", label: "Replicate (image / audio / video / 3D)", kind: "video" },
];

/** True only in the browser build, which sets this global at startup. */
function isWebBuild(): boolean {
  return typeof window !== "undefined" && (window as unknown as { __HS_WEB__?: boolean }).__HS_WEB__ === true;
}

export function SettingsView() {
  const { settings, saveSettings, setView, init } = useStore();
  const [draft, setDraft] = useState<Settings>(() => structuredClone(settings));
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as Tab) : "general";
  });

  const openTab = (id: Tab) => {
    setTab(id);
    localStorage.setItem(TAB_KEY, id);
    // Each panel is its own page — start it at the top.
    document.querySelector(".settings-body")?.scrollTo({ top: 0 });
  };
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState("");
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [winVoices, setWinVoices] = useState<SysVoice[]>([]);
  const [extraErr, setExtraErr] = useState<Record<string, string>>({});
  const [showMemories, setShowMemories] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [tidying, setTidying] = useState<string | null>(null);
  const [rwBusy, setRwBusy] = useState(false);
  const [rwTest, setRwTest] = useState<RewriteTestResult | null>(null);

  /** Run the speech rewriter against a fixed sample so you can judge it before relying on it. */
  const runRewriteTest = async () => {
    const provider = draft.providers.find((p) => p.id === draft.voice?.speechProviderId);
    const model = draft.voice?.speechModel || provider?.models[0] || "";
    if (!provider || !model) {
      setRwTest({
        ok: false,
        input: "",
        output: "",
        usedModel: false,
        ms: 0,
        note: "pick a provider and model first",
      });
      return;
    }
    setRwBusy(true);
    try {
      setRwTest(await testRewrite({ provider, model }));
    } finally {
      setRwBusy(false);
    }
  };
  const [showSpend, setShowSpend] = useState(false);
  const spendRef = useModal(showSpend, () => setShowSpend(false));
  const memoriesRef = useModal(showMemories, () => setShowMemories(false));
  const [spend, setSpend] = useState<SpendTotals>(() => totals());

  // Keep the spend readout live while requests are running.
  useEffect(() => onSpendChange(() => setSpend(totals())), []);
  const [micDevices, setMicDevices] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const testRec = useRef<Recorder | null>(null);
  const testTimer = useRef<number | null>(null);

  const [previewing, setPreviewing] = useState<string | null>(null);

  // VRM avatars live under ~/.harnessx/avatars; importing copies the file in.
  const [avatars, setAvatars] = useState<storage.AvatarFile[]>([]);
  const [importingAvatar, setImportingAvatar] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);

  const refreshAvatars = () => void storage.listAvatars().then(setAvatars);
  useEffect(refreshAvatars, []);

  const importAvatar = async (file: File) => {
    setImportingAvatar("Importing…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // A .vrm is self-contained; an MMD model needs its texture folder, so it
      // comes in as a zip and is extracted.
      const zipped = /\.zip$/i.test(file.name);
      if (zipped) setImportingAvatar("Extracting…");
      const name = zipped
        ? await storage.saveAvatarArchive(file.name, bytes)
        : await storage.saveAvatar(file.name, bytes);
      refreshAvatars();
      setDraft((d) => ({ ...d, voice: { ...d.voice, avatarFile: name } }));
      toast.success(`Added ${name.split("/")[0]}`);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message || String(e)}`);
    } finally {
      setImportingAvatar(null);
    }
  };

  const removeAvatar = async (file: string) => {
    if (!(await confirmDialog(`Remove ${file}?`, { danger: true }))) return;
    await storage.deleteAvatar(file);
    refreshAvatars();
    setDraft((d) => ({ ...d, voice: { ...d.voice, avatarFile: "" } }));
  };

  const [neuralReady, setNeuralReady] = useState<boolean | null>(null);
  const neuralEngine = (draft.voice?.ttsEngine ?? "auto") === "piper";
  const neuralVoiceId = draft.voice?.piperVoice ?? DEFAULT_PIPER_VOICE;

  // Tell the user whether the neural voice is on disk before they hit Preview and
  // wonder why nothing happens for a minute.
  useEffect(() => {
    if (!neuralEngine) return;
    let live = true;
    setNeuralReady(null);
    void piperReady(neuralVoiceId).then((r) => live && setNeuralReady(r));
    return () => {
      live = false;
    };
  }, [neuralEngine, neuralVoiceId]);

  const previewVoice = async () => {
    setPreviewing("Preparing…");
    try {
      if ((draft.voice?.ttsEngine ?? "auto") === "piper") {
        const { ensurePiper, DEFAULT_PIPER_VOICE } = await import("../lib/piper");
        await ensurePiper((s) => setPreviewing(s), draft.voice?.piperVoice || DEFAULT_PIPER_VOICE);
        invalidateNeuralVoice(); // so "Auto" starts using it right away
        setNeuralReady(true);
      }
      if ((draft.voice?.ttsEngine ?? "auto") === "kokoro") {
        // The first preview is a ~90 MB download. Show it moving, or the button
        // just sits there saying "Preparing…" for a couple of minutes.
        const { loadKokoro } = await import("../lib/kokoro");
        await loadKokoro((percent, label) =>
          setPreviewing(percent >= 100 ? "Warming up…" : `${label} ${percent}%`),
        );
      }
      setPreviewing("Speaking…");
      await speakNow("Hi, this is how I'll sound when we talk.", draft);
    } catch (e) {
      toast.error(`Preview failed: ${(e as Error).message || String(e)}`);
    } finally {
      setPreviewing(null);
    }
  };

  const toggleMicTest = async () => {
    if (testing) {
      setTesting(false);
      if (testTimer.current) clearInterval(testTimer.current);
      testTimer.current = null;
      setTestLevel(0);
      const rec = testRec.current;
      testRec.current = null;
      try {
        await rec?.stopPath();
      } catch {
        /* already stopped */
      }
      return;
    }
    try {
      testRec.current = await startRecording(draft.voice?.micDevice);
      setTesting(true);
      testTimer.current = window.setInterval(async () => setTestLevel(await micLevel()), 90);
    } catch (e) {
      toast.error(`Microphone unavailable: ${(e as Error).message || String(e)}`);
    }
  };

  useEffect(
    () => () => {
      if (testTimer.current) clearInterval(testTimer.current);
      void testRec.current?.stopPath().catch(() => {});
    },
    [],
  );
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);

  useEffect(() => {
    void checkForUpdate().then(setUpdate);
  }, []);

  const runUpdateCheck = async () => {
    setChecking(true);
    try {
      const info = await checkForUpdate();
      setUpdate(info);
      toast[info.available ? "success" : "info"](
        info.available ? `Update ${info.version} available` : "You're on the latest version",
      );
    } finally {
      setChecking(false);
    }
  };

  const exportAll = async () => {
    setDataMsg("Exporting...");
    try {
      const now = new Date();
      const stamp = now.toISOString().replace(/[:.]/g, "-");
      const bundle = await storage.exportBundle(now.toISOString());
      const rel = await storage.writeBackup(bundle, stamp);
      // also offer a direct download
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `harnessstation-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setDataMsg(`Backup saved to ~\\.harnessx\\${rel.replace("/", "\\")} (and downloaded).`);
      toast.success("Backup exported");
    } catch (e) {
      setDataMsg(`Export failed: ${(e as Error).message || String(e)}`);
      toast.error("Export failed");
    }
  };

  const importAll = async (file: File) => {
    if (!(await confirmDialog("Import backup?", { message: "This merges the backup into your current data (existing items with the same id are overwritten)." }))) return;
    setDataMsg("Importing...");
    try {
      const bundle = JSON.parse(await file.text());
      await storage.importBundle(bundle);
      await init();
      setDataMsg("Import complete — data reloaded.");
      setDraft(structuredClone(useStore.getState().settings));
      toast.success("Backup imported");
    } catch (e) {
      setDataMsg(`Import failed: ${(e as Error).message || String(e)}`);
      toast.error("Import failed");
    }
  };

  const patchProvider = (id: string, patch: Partial<Provider>) => {
    setDraft({
      ...draft,
      providers: draft.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  };

  const mediaModels = draft.mediaModels ?? [];
  const patchMedia = (id: string, patch: Partial<MediaModel>) =>
    setDraft({ ...draft, mediaModels: mediaModels.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const addMedia = () =>
    setDraft({
      ...draft,
      mediaModels: [
        ...mediaModels,
        {
          id: `media-${Date.now()}`,
          name: "New image model",
          kind: "image",
          engine: "openai-image",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          model: "gpt-image-1",
          options: "1024x1024",
        },
      ],
    });
  const removeMedia = (id: string) => {
    const defaults = { ...(draft.defaultMediaIds ?? {}) };
    for (const k of Object.keys(defaults) as MediaKind[]) if (defaults[k] === id) delete defaults[k];
    setDraft({ ...draft, mediaModels: mediaModels.filter((m) => m.id !== id), defaultMediaIds: defaults });
  };
  const setDefaultMedia = (kind: MediaKind, id: string) =>
    setDraft({ ...draft, defaultMediaIds: { ...(draft.defaultMediaIds ?? {}), [kind]: id || undefined } });

  const addProvider = () => {
    setDraft({
      ...draft,
      providers: [
        ...draft.providers,
        {
          id: `custom-${Date.now()}`,
          name: "New provider",
          kind: "openai-compatible",
          baseUrl: "http://localhost:8080/v1",
          apiKey: "",
          models: [],
        },
      ],
    });
  };

  const save = async () => {
    await saveSettings(draft);
    setSaved(true);
    toast.success("Settings updated");
    setTimeout(() => setSaved(false), 1500);
  };

  /**
   * Whether the draft differs from what's stored.
   *
   * The panel edits a copy and only commits on Save, so without this it's
   * entirely possible to change six things, wander off, and lose all of them
   * with no indication anything was pending.
   */
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  /** Sections matching the search box, by label, blurb or keyword. */
  const q = query.trim().toLowerCase();
  const matches = q
    ? TABS.filter((t) => `${t.label} ${t.blurb} ${t.keywords}`.toLowerCase().includes(q))
    : [...TABS];

  // Ctrl+S, because this is a form with an explicit Save and everyone tries it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const leave = () => {
    if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
    setView("chat");
  };

  return (
    <main className="settings-main settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        {dirty && <span className="dirty-dot" title="Unsaved changes" aria-live="polite">Unsaved changes</span>}
        <div className="grow" />
        <button className="btn" onClick={leave}>
          ← Back
        </button>
        <button className="btn primary" disabled={!dirty && !saved} onClick={() => void save()}>
          {saved ? "Saved ✓" : dirty ? "Save (Ctrl+S)" : "Saved"}
        </button>
      </div>

      <div className="settings-shell">
        <nav className="settings-rail" aria-label="Settings sections">
          <input
            className="settings-search"
            type="search"
            value={query}
            placeholder="Search settings…"
            aria-label="Search settings"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter goes to the first match, so a search can be driven entirely
              // from the keyboard.
              if (e.key === "Enter" && matches[0]) openTab(matches[0].id);
              if (e.key === "Escape") setQuery("");
            }}
          />
          {matches.length === 0 && <p className="hint rail-empty">Nothing matches “{query}”.</p>}
          {matches.map((t) => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? "active" : ""}`}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => openTab(t.id)}
            >
              <span className="settings-tab-label">{t.label}</span>
              <span className="settings-tab-blurb">{t.blurb}</span>
            </button>
          ))}
        </nav>

        <div className="settings-body">

      <section hidden={tab !== "general"}>
        <h2>System instructions (global)</h2>
        <p className="hint">Prepended to every chat, before style and per-chat prompts.</p>
        <textarea
          rows={5}
          value={draft.globalInstructions}
          placeholder="e.g. Always answer in English. I'm a beginner programmer — explain things simply."
          onChange={(e) => setDraft({ ...draft, globalInstructions: e.target.value })}
        />
      </section>

      <section hidden={tab !== "providers"}>
        <h2>Connections</h2>
        <p className="hint">
          Shared data the app fetches on your behalf — model benchmarks, the MCP directory,
          Hugging Face search — comes from the HarnessStation gateway, so no key of ours ships
          inside the app.{" "}
          {hasBuiltInGateway()
            ? "This build has one configured; leave the field below empty unless you run your own."
            : "This build has none configured, so benchmarks need either your own gateway below or your own Artificial Analysis key."}
        </p>
        <p className="hint" style={{ marginBottom: 12 }}>
          <b>Your</b> provider keys — models, image/voice generation, MCP servers — never go through
          it. They stay on this machine and are sent only to the service they belong to.
        </p>
        <div className="provider-row">
          <input
            className="grow"
            value={draft.serverUrl ?? ""}
            placeholder="Self-hosted gateway URL (optional), e.g. https://gateway.example.com"
            onChange={(e) => setDraft({ ...draft, serverUrl: e.target.value })}
          />
          <input
            className="grow"
            type="password"
            value={draft.aaApiKey ?? ""}
            placeholder="Your own Artificial Analysis key (only if not using a gateway)"
            onChange={(e) => setDraft({ ...draft, aaApiKey: e.target.value })}
          />
        </div>
      </section>

      <section hidden={tab !== "providers"}>
        <h2>Embeddings (memory &amp; knowledge)</h2>
        <p className="hint">
          Used for semantic recall in agent memory and knowledge bases. Leave blank to fall back to
          keyword matching. Common: OpenAI <code>text-embedding-3-small</code>, Ollama <code>nomic-embed-text</code>.
        </p>
        <div className="provider-row">
          <select
            value={draft.embedProviderId ?? ""}
            onChange={(e) => {
              const p = draft.providers.find((x) => x.id === e.target.value);
              setDraft({ ...draft, embedProviderId: e.target.value, embedModel: draft.embedModel || (p ? "" : "") });
            }}
          >
            <option value="">No embeddings (keyword recall)</option>
            {draft.providers
              .filter((p) => p.kind === "openai-compatible")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <input
            className="grow"
            value={draft.embedModel ?? ""}
            placeholder="Embedding model, e.g. text-embedding-3-small"
            onChange={(e) => setDraft({ ...draft, embedModel: e.target.value })}
          />
        </div>
      </section>

      <section hidden={tab !== "memory"}>
        <h2>Memory</h2>
        <label className="agent-check">
          <input
            type="checkbox"
            checked={draft.passiveMemory ?? false}
            onChange={(e) => setDraft({ ...draft, passiveMemory: e.target.checked })}
          />
          Remember things automatically across every chat
        </label>
        <p className="hint" style={{ marginTop: 4 }}>
          Facts about you and your work are harvested in the background — when the topic shifts or
          every few turns — and the relevant ones are dropped into the prompt on later turns. No
          memory tool calls, so it costs no tokens deciding what to look up. Works far better with an
          embedding model set above; without one it falls back to keyword matching.
        </p>
        {(draft.passiveMemory ?? false) && (
          <>
            <label className="field" style={{ maxWidth: 260 }}>
              <span>Facts recalled per turn: {draft.memoryK ?? 6}</span>
              <input
                type="range"
                min={2}
                max={15}
                step={1}
                value={draft.memoryK ?? 6}
                onChange={(e) => setDraft({ ...draft, memoryK: Number(e.target.value) })}
              />
            </label>
            <div className="provider-row">
              <button
                className="btn"
                onClick={() => {
                  void import("../lib/memory").then(async (m) => {
                    setMemories(await m.listMemories(m.GLOBAL_MEMORY));
                    setShowMemories(true);
                  });
                }}
              >
                View what it remembers
              </button>
              <button
                className="btn"
                disabled={!!tidying}
                onClick={() => {
                  const p = draft.providers.find((x) => x.id === draft.embedProviderId) ?? draft.providers[0];
                  if (!p?.models.length) {
                    setTidying("No provider available");
                    return;
                  }
                  setTidying("Tidying…");
                  void import("../lib/memory").then(async (m) => {
                    const removed = await m.consolidate(m.GLOBAL_MEMORY, p, p.models[0], true);
                    setTidying(removed ? `Merged away ${removed}` : "Nothing to merge");
                    setTimeout(() => setTidying(null), 3000);
                  });
                }}
              >
                {tidying ?? "Tidy up now"}
              </button>
            </div>
            <p className="hint">
              Tidying merges duplicate facts, drops the older side of a contradiction, and retires
              stale ones. It runs by itself at most once every 6 hours once there are 25+ facts; this
              button forces it. A response that would delete most of the store is rejected — losing
              memory is worse than a slightly bloated one.
            </p>
          </>
        )}
      </section>

      <section hidden={tab !== "devices"}>
        <DevicesPanel />
      </section>

      <section hidden={tab !== "secrets"}>
        <SecretsPanel />
      </section>

      <section hidden={tab !== "hooks"}>
        <HooksPanel />
      </section>

      <section hidden={tab !== "channels"}>
        <ChannelsPanel />
      </section>

      <section hidden={tab !== "usage"}>
        <h2>Spend</h2>
        <p className="hint">
          Estimated from the pricing in Benchmarks, so treat it as a close guide rather than a bill.
          Caps are checked before every request <em>and</em> between tool rounds, so a long
          unattended chain can't sail past them.
        </p>
        <div className="provider-row">
          <span className="grow">
            <strong>{formatCost(spend.todayUsd)}</strong> today ·{" "}
            <strong>{formatCost(spend.monthUsd)}</strong> this month ·{" "}
            {(spend.todayTokens / 1000).toFixed(1)}k tokens today
          </span>
          <button className="btn" onClick={() => setShowSpend(true)}>
            Breakdown
          </button>
        </div>
        {spend.unpricedCalls > 0 && (
          <p className="hint">
            {spend.unpricedCalls} call{spend.unpricedCalls === 1 ? "" : "s"} used a model with no
            pricing data, so they aren't counted above and can't be capped. Refresh Benchmarks to
            pick up prices.
          </p>
        )}
        <div className="provider-row">
          <label className="field grow">
            <span>Daily cap (USD, blank = none)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder="e.g. 5"
              value={draft.dailyCapUsd ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dailyCapUsd: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
          <label className="field grow">
            <span>Monthly cap (USD, blank = none)</span>
            <input
              type="number"
              min={0}
              step={5}
              placeholder="e.g. 50"
              value={draft.monthlyCapUsd ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  monthlyCapUsd: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
          </label>
        </div>
      </section>

      <section hidden={tab !== "general"}>
        <h2>Background</h2>
        <label className="agent-check">
          <input
            type="checkbox"
            checked={draft.backgroundMode ?? true}
            onChange={(e) => setDraft({ ...draft, backgroundMode: e.target.checked })}
          />
          Keep running in the tray when I close the window
        </label>
        <p className="hint" style={{ marginTop: 4 }}>
          The app stays in the notification area so the voice avatar keeps listening and schedules
          keep firing with no window on screen. Left-click the tray icon to come back, or hold{" "}
          <code>Ctrl+Shift+V</code> from any app to talk. Quit properly from the tray menu.
        </p>
      </section>

      {showSpend && (
        <div className="modal-backdrop" onClick={() => setShowSpend(false)}>
          <div
            className="modal"
            ref={spendRef}
            role="dialog"
            aria-modal="true"
            aria-label="Spend by model"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Spend by model</h3>
            {spend.byModel.length === 0 && <p className="hint">Nothing recorded yet.</p>}
            <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
              {spend.byModel.map((m) => (
                <div key={m.model} className="provider-row">
                  <span className="grow">{m.model}</span>
                  <span className="hint">
                    {(m.tokens / 1000).toFixed(1)}k tok · {m.calls} calls
                  </span>
                  <strong>{formatCost(m.usd)}</strong>
                </div>
              ))}
            </div>
            <div className="provider-row">
              <button
                className="btn danger"
                onClick={() => {
                  void import("../lib/budget").then((b) => {
                    b.resetSpend();
                    setSpend(b.totals());
                  });
                }}
              >
                Reset ledger
              </button>
              <button className="btn" onClick={() => setShowSpend(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showMemories && (
        <div className="modal-backdrop" onClick={() => setShowMemories(false)}>
          <div
            className="modal"
            ref={memoriesRef}
            role="dialog"
            aria-modal="true"
            aria-label="Remembered facts"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Remembered facts ({memories.length})</h3>
            {memories.length === 0 && (
              <p className="hint">Nothing yet — it fills up as you chat.</p>
            )}
            <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
              {memories.map((m) => (
                <div key={`${m.ts}-${m.text}`} className="provider-row">
                  <span className="grow">{m.text}</span>
                  <button
                    className="icon-btn"
                    title="Forget this"
                    onClick={() => {
                      void import("../lib/memory").then(async (mod) => {
                        await mod.forget(mod.GLOBAL_MEMORY, m.text);
                        setMemories(await mod.listMemories(mod.GLOBAL_MEMORY));
                      });
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
            <div className="provider-row">
              <button
                className="btn danger"
                onClick={() => {
                  void import("../lib/memory").then(async (mod) => {
                    await mod.forgetAll(mod.GLOBAL_MEMORY);
                    setMemories([]);
                  });
                }}
              >
                Forget everything
              </button>
              <button className="btn" onClick={() => setShowMemories(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <section hidden={tab !== "media"}>
        <h2>
          Media models (image · voice · video){" "}
          <button className="btn small" onClick={addMedia}>
            + Add
          </button>
        </h2>
        <p className="hint">
          Generation models the chat can call via the <code>generate_image</code>,{" "}
          <code>generate_speech</code>, and <code>generate_video</code> tools (enable them per chat).
          Use cloud endpoints (OpenAI, Replicate) or a local engine by its URL (Stable Diffusion
          webui, an OpenAI-compatible TTS server). The chosen defaults below are what the tools call.
        </p>

        {(["image", "audio", "video", "3d"] as MediaKind[]).map((kind) => {
          const opts = mediaModels.filter((m) => m.kind === kind);
          if (!opts.length) return null;
          return (
            <label className="field" key={kind} style={{ maxWidth: 360 }}>
              <span>Default {kind} model</span>
              <select
                value={draft.defaultMediaIds?.[kind] ?? ""}
                onChange={(e) => setDefaultMedia(kind, e.target.value)}
              >
                <option value="">First {kind} model</option>
                {opts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        {mediaModels.map((m) => (
          <div key={m.id} className="provider-card">
            <div className="provider-row">
              <input
                className="provider-name"
                value={m.name}
                onChange={(e) => patchMedia(m.id, { name: e.target.value })}
              />
              <select
                value={m.engine}
                onChange={(e) => {
                  const eng = MEDIA_ENGINES.find((x) => x.value === (e.target.value as MediaEngine));
                  patchMedia(m.id, { engine: e.target.value as MediaEngine, kind: eng?.kind ?? m.kind });
                }}
              >
                {MEDIA_ENGINES.map((eng) => (
                  <option key={eng.value} value={eng.value}>
                    {eng.label}
                  </option>
                ))}
              </select>
              <select value={m.kind} onChange={(e) => patchMedia(m.id, { kind: e.target.value as MediaKind })}>
                <option value="image">image</option>
                <option value="audio">audio/voice</option>
                <option value="video">video</option>
                <option value="3d">3D model</option>
              </select>
              <button className="icon-btn" title="Remove" onClick={() => removeMedia(m.id)}>
                ×
              </button>
            </div>
            <div className="provider-row">
              <input
                className="grow"
                value={m.baseUrl}
                placeholder="Base URL (e.g. https://api.replicate.com/v1 or http://localhost:7860)"
                onChange={(e) => patchMedia(m.id, { baseUrl: e.target.value })}
              />
              <input
                className="grow"
                type="password"
                value={m.apiKey ?? ""}
                placeholder="API key (blank for local)"
                onChange={(e) => patchMedia(m.id, { apiKey: e.target.value })}
              />
            </div>
            <div className="provider-row">
              <input
                className="grow"
                value={m.model}
                placeholder="Model / version (e.g. gpt-image-1, tts-1, or a Replicate version hash)"
                onChange={(e) => patchMedia(m.id, { model: e.target.value })}
              />
              <input
                value={m.options ?? ""}
                placeholder={m.kind === "audio" ? "Voice (e.g. alloy)" : "Size (e.g. 1024x1024)"}
                onChange={(e) => patchMedia(m.id, { options: e.target.value })}
              />
            </div>
          </div>
        ))}
        {mediaModels.length === 0 && (
          <p className="hint">No media models yet. Add one, or set one up from Discover.</p>
        )}
      </section>

      <section hidden={tab !== "voice"}>
        <h2>Voice avatar</h2>
        <p className="hint">
          Talk to a model out loud: speech → model → speech. Hold <code>Ctrl+Shift+V</code> anywhere
          to talk, or switch the avatar to always-listening. Replies use the built-in Windows voice
          unless you set an audio model above, which is then used instead.
        </p>
        <div className="provider-row">
          <label className="field grow">
            <span>Microphone</span>
            <select
              value={draft.voice?.micDevice ?? ""}
              onFocus={() => {
                if (!micDevices.length) void listMicDevices().then(setMicDevices);
              }}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, micDevice: e.target.value } })}
            >
              <option value="">System default</option>
              {micDevices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Test {testing ? "— speak now" : ""}</span>
            <div className="mic-test-row">
              <button className={`btn ${testing ? "danger" : ""}`} onClick={() => void toggleMicTest()}>
                {testing ? "Stop test" : "Test mic"}
              </button>
              <div className="mic-meter">
                <div
                  className="mic-meter-fill"
                  style={{ width: `${Math.min(100, testLevel * 900)}%` }}
                />
              </div>
            </div>
          </label>
        </div>
        <p className="hint">
          Pick the mic you actually speak into (headset, not the webcam). Hit <b>Test mic</b> and
          talk — the bar should move well past the middle. If it barely moves, choose another device
          or raise its level in Windows sound settings.
        </p>
        <div className="provider-row">
          <label className="field grow">
            <span>Speech recognition model</span>
            <select
              value={draft.voice?.sttModel ?? DEFAULT_STT}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, sttModel: e.target.value } })}
            >
              {STT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span>Voice engine</span>
            <select
              value={draft.voice?.ttsEngine ?? "auto"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: {
                    ...draft.voice,
                    ttsEngine: e.target.value as NonNullable<Settings["voice"]>["ttsEngine"],
                  },
                })
              }
            >
              <option value="auto">Auto — the best voice already installed</option>
              <option value="kokoro">Kokoro — local AI voice, best free quality</option>
              <option value="cloud">Cloud service — best quality, your key</option>
              <option value="piper">Piper — offline, lighter than Kokoro</option>
              <option value="windows">Windows built-in — fastest, flattest</option>
            </select>
          </label>
          {(draft.voice?.ttsEngine ?? "auto") === "piper" && (
            <label className="field grow">
              <span>Neural voice</span>
              <select
                value={draft.voice?.piperVoice ?? DEFAULT_PIPER_VOICE}
                onChange={(e) =>
                  setDraft({ ...draft, voice: { ...draft.voice, piperVoice: e.target.value } })
                }
              >
                {PIPER_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(draft.voice?.ttsEngine ?? "auto") === "kokoro" && (
            <label className="field grow">
              <span>Kokoro voice</span>
              <select
                value={draft.voice?.kokoroVoice ?? DEFAULT_KOKORO_VOICE}
                onChange={(e) =>
                  setDraft({ ...draft, voice: { ...draft.voice, kokoroVoice: e.target.value } })
                }
              >
                {KOKORO_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {(draft.voice?.ttsEngine ?? "auto") === "kokoro" && (
          <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
            {kokoroVoice(draft.voice?.kokoroVoice ?? DEFAULT_KOKORO_VOICE).note} Runs on this
            machine — no key, no per-word cost, works offline once fetched. The first Preview
            downloads the model (~90 MB, one time); after that "Auto" uses it too. English only,
            and synthesis is CPU-bound, so a long reply takes a moment to start.
          </p>
        )}

        {(draft.voice?.ttsEngine ?? "auto") === "cloud" && (
          <div className="cloud-tts">
            <div className="provider-row">
              <label className="field grow">
                <span>Service</span>
                <select
                  value={draft.voice?.cloud?.engine ?? "openai"}
                  onChange={(e) => {
                    const engine = e.target.value as SpeechEngine;
                    const info = engineInfo(engine);
                    setDraft({
                      ...draft,
                      voice: {
                        ...draft.voice,
                        cloud: {
                          // Switching service must reset the model and voice: an
                          // ElevenLabs voice id means nothing to Cartesia, and the
                          // resulting 404 looks like a broken key.
                          ...draft.voice?.cloud,
                          engine,
                          apiKey: draft.voice?.cloud?.engine === engine ? (draft.voice?.cloud?.apiKey ?? "") : "",
                          model: info.defaultModel,
                          voice: info.defaultVoice,
                        },
                      },
                    });
                  }}
                >
                  {SPEECH_ENGINES.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field grow">
                <span>Voice</span>
                <select
                  value={draft.voice?.cloud?.voice ?? engineInfo(draft.voice?.cloud?.engine ?? "openai").defaultVoice}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      voice: {
                        ...draft.voice,
                        cloud: {
                          engine: draft.voice?.cloud?.engine ?? "openai",
                          apiKey: draft.voice?.cloud?.apiKey ?? "",
                          ...draft.voice?.cloud,
                          voice: e.target.value,
                        },
                      },
                    })
                  }
                >
                  {engineInfo(draft.voice?.cloud?.engine ?? "openai").voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="provider-row">
              <label className="field grow">
                <span>API key</span>
                <input
                  type="password"
                  placeholder="Your own key — it stays on this machine"
                  value={draft.voice?.cloud?.apiKey ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      voice: {
                        ...draft.voice,
                        cloud: {
                          engine: draft.voice?.cloud?.engine ?? "openai",
                          ...draft.voice?.cloud,
                          apiKey: e.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="field grow">
                <span>Model</span>
                <input
                  value={draft.voice?.cloud?.model ?? engineInfo(draft.voice?.cloud?.engine ?? "openai").defaultModel}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      voice: {
                        ...draft.voice,
                        cloud: {
                          engine: draft.voice?.cloud?.engine ?? "openai",
                          apiKey: draft.voice?.cloud?.apiKey ?? "",
                          ...draft.voice?.cloud,
                          model: e.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
            </div>
            <p className="hint">
              {engineInfo(draft.voice?.cloud?.engine ?? "openai").note} Billed per character by{" "}
              {engineInfo(draft.voice?.cloud?.engine ?? "openai").label}, not by us — get a key at{" "}
              <code>{engineInfo(draft.voice?.cloud?.engine ?? "openai").keyUrl}</code>. If a request
              fails, the avatar falls back to a local voice rather than going quiet.
            </p>
          </div>
        )}
        {neuralEngine && (
          <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
            {neuralReady === null
              ? "Checking the neural voice…"
              : neuralReady
                ? "Neural voice installed — Preview to hear it."
                : `Not downloaded yet. Preview installs the engine and voice (~${
                    piperVoice(draft.voice?.piperVoice ?? DEFAULT_PIPER_VOICE).mb + 20
                  } MB, one time). Once installed, "Auto" uses it too.`}
          </p>
        )}
        <div className="provider-row">
          <button className="btn" disabled={!!previewing} onClick={() => void previewVoice()}>
            {previewing ?? "▶ Preview voice"}
          </button>
        </div>

        <h3 className="sub-head">Avatar</h3>
        <div className="provider-row">
          <label className="field grow">
            <span>On-screen character</span>
            <select
              value={draft.voice?.avatarFile ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, voice: { ...draft.voice, avatarFile: e.target.value } })
              }
            >
              <option value="">Orb — no character</option>
              {avatars.map((a) => (
                <option key={a.file} value={a.file}>
                  {a.name} — {a.kind.toUpperCase()} ({a.sizeMB} MB)
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" onClick={() => setShowGallery(true)}>
            Browse free avatars
          </button>
          <button className="btn" onClick={() => avatarRef.current?.click()}>
            {importingAvatar ?? "Upload model"}
          </button>
          {draft.voice?.avatarFile && (
            <button
              className="btn danger"
              onClick={() => void removeAvatar(draft.voice!.avatarFile!)}
            >
              Remove
            </button>
          )}
          <input
            ref={avatarRef}
            type="file"
            accept=".vrm,.zip"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importAvatar(f);
            }}
          />
        </div>
        {showGallery && (
          <AvatarGallery
            onClose={() => setShowGallery(false)}
            onInstalled={(file) => {
              refreshAvatars();
              setDraft((d) => ({ ...d, voice: { ...d.voice, avatarFile: file } }));
            }}
          />
        )}
        <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
          <b>VRM</b> is the open VTuber format — browse the free CC0 catalogue above, upload a
          .vrm, or grab one from{" "}
          <a href="https://hub.vroid.com" target="_blank" rel="noreferrer">
            VRoid Hub
          </a>
          . <b>MMD</b> (MikuMikuDance) models work too: zip the model folder — the .pmx or .pmd
          together with its texture files — and upload the zip. Either way the character lip-syncs
          to speech, blinks, and reacts to whether it's listening, thinking or talking. Check each
          model's terms before using it; MMD models in particular often carry usage restrictions.
        </p>
        <div className="provider-row">
          <label className="field grow">
            <span>Windows voice</span>
            <select
              value={draft.voice?.winVoice ?? ""}
              onFocus={() => {
                if (!winVoices.length) void listSystemVoices().then(setWinVoices);
              }}
              onChange={(e) => setDraft({ ...draft, voice: { ...draft.voice, winVoice: e.target.value } })}
            >
              <option value="">Auto — match the language being spoken</option>
              {winVoices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                  {v.lang ? ` — ${v.lang}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Speaking rate: {draft.voice?.rate ?? 1}</span>
            <input
              type="range"
              min={-5}
              max={6}
              step={1}
              value={draft.voice?.rate ?? 1}
              onChange={(e) =>
                setDraft({ ...draft, voice: { ...draft.voice, rate: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <div className="provider-row">
          <label className="field">
            <span>Mic sensitivity: {(draft.voice?.threshold ?? 0.02).toFixed(3)}</span>
            <input
              type="range"
              min={0.005}
              max={0.08}
              step={0.005}
              value={draft.voice?.threshold ?? 0.02}
              onChange={(e) =>
                setDraft({ ...draft, voice: { ...draft.voice, threshold: Number(e.target.value) } })
              }
            />
          </label>
          <label className="field">
            <span>End of speech after (ms of silence)</span>
            <input
              type="number"
              min={300}
              step={100}
              value={draft.voice?.silenceMs ?? 900}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, silenceMs: Number(e.target.value) || 900 },
                })
              }
            />
          </label>
          <label className="field">
            <span>Unfinished-sentence grace (ms)</span>
            <input
              type="number"
              min={600}
              step={100}
              value={draft.voice?.holdMs ?? 2200}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  voice: { ...draft.voice, holdMs: Number(e.target.value) || 2200 },
                })
              }
            />
          </label>
        </div>
        <p className="hint">
          Lower sensitivity if it cuts you off mid-sentence in always-listening mode; raise it if
          background noise keeps triggering it. The grace window only applies when what you said
          sounds unfinished ("…I want you to") — a complete sentence still ends after the normal
          silence, so quick replies stay quick. Toggle it on the Voice Avatar screen.
        </p>

        <label className="agent-check" style={{ marginTop: 14 }}>
          <input
            type="checkbox"
            checked={draft.voice?.speechRewrite ?? false}
            onChange={(e) =>
              setDraft({ ...draft, voice: { ...draft.voice, speechRewrite: e.target.checked } })
            }
          />
          Polish each reply with a small model before speaking it
        </label>
        <p className="hint" style={{ marginTop: 4 }}>
          A second, tiny model rewrites the answer into spoken English — breaking up long sentences,
          saying "your Desktop folder" instead of a file path, dropping written-only phrasing. It runs
          while the previous sentence is still playing, so it costs almost no extra wait, and any
          timeout or odd result falls back to the original text. Pick the smallest model you have —
          a 1–3 B local one is ideal.
        </p>
        {(draft.voice?.speechRewrite ?? false) && (
          <div className="provider-row">
            <label className="field grow">
              <span>Rewriter provider</span>
              <select
                value={draft.voice?.speechProviderId ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    voice: { ...draft.voice, speechProviderId: e.target.value, speechModel: "" },
                  })
                }
              >
                <option value="">Select a provider…</option>
                {draft.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Rewriter model</span>
              <input
                list="speech-rewrite-models"
                placeholder="e.g. llama3.2:1b"
                value={draft.voice?.speechModel ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, voice: { ...draft.voice, speechModel: e.target.value } })
                }
              />
              <datalist id="speech-rewrite-models">
                {(draft.providers.find((p) => p.id === draft.voice?.speechProviderId)?.models ?? []).map(
                  (m) => (
                    <option key={m} value={m} />
                  ),
                )}
              </datalist>
            </label>
          </div>
        )}
        {(draft.voice?.speechRewrite ?? false) && (
          <>
            <div className="provider-row">
              <button className="btn" disabled={rwBusy} onClick={() => void runRewriteTest()}>
                {rwBusy ? "Testing…" : "Test rewriter"}
              </button>
              {rwTest?.ok && (
                <button
                  className="btn"
                  onClick={() => void speakNow(rwTest.output, draft)}
                  title="Hear the rewritten version"
                >
                  ▶ Hear it
                </button>
              )}
            </div>
            {rwTest && (
              <div className={`rw-test ${rwTest.ok ? "" : "rw-test-bad"}`}>
                <div className="rw-test-head">
                  {rwTest.ok
                    ? `Working — ${rwTest.ms}ms per utterance`
                    : `Not usable — ${rwTest.note}`}
                </div>
                <div className="rw-test-row">
                  <span className="rw-test-label">Before</span>
                  <span>{rwTest.input}</span>
                </div>
                {rwTest.usedModel && (
                  <div className="rw-test-row">
                    <span className="rw-test-label">After</span>
                    <span>{rwTest.output}</span>
                  </div>
                )}
                <p className="hint">
                  A good result says the path and the percentage the way a person would, splits the
                  long sentence up, and keeps every fact. If it invented anything or dropped the
                  file name, use a different model.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <section hidden={tab !== "general"}>
        <h2>Conversation</h2>
        <label className="agent-check">
          <input
            type="checkbox"
            checked={draft.autoTitle ?? true}
            onChange={(e) => setDraft({ ...draft, autoTitle: e.target.checked })}
          />
          Name new chats automatically
        </label>
        <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
          After the first reply, a short completion on the same model turns the opening message into a
          title. Costs a few tokens per new chat — turn off to keep the truncated first message instead.
        </p>
        <label className="agent-check">
          <input
            type="checkbox"
            checked={draft.autoContinue ?? true}
            onChange={(e) => setDraft({ ...draft, autoContinue: e.target.checked })}
          />
          Auto-continue tool tasks (keep working without a manual "continue")
        </label>
        <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
          When on, the model runs a long chain of tool steps unattended (up to 60) to finish a task;
          a guard stops it if it repeats the same call without progress. Turn off to cap turns sooner
          and control cost. Use the Stop button any time.
        </p>
        <label className="agent-check">
          <input
            type="checkbox"
            checked={draft.autoEnableTools ?? true}
            onChange={(e) => setDraft({ ...draft, autoEnableTools: e.target.checked })}
          />
          Let the model enable tools it finds itself
        </label>
        <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
          With the <code>find_tools</code> and <code>enable_tool</code> tools switched on, the model can
          search everything the app offers and turn on what it needs mid-task. Credential-free tools go
          on silently; destructive ones and MCP servers needing a key always ask you first. Turn this off
          to be asked every single time.
        </p>
        <label className="agent-check">
          <input
            type="checkbox"
            checked={draft.autoCompact ?? false}
            onChange={(e) => setDraft({ ...draft, autoCompact: e.target.checked })}
          />
          Auto-summarize old turns in long chats
        </label>
        <label className="field" style={{ maxWidth: 260, marginTop: 8 }}>
          <span>Compact when a chat exceeds (approx tokens)</span>
          <input
            type="number"
            min={2000}
            step={1000}
            value={draft.compactThreshold ?? 8000}
            onChange={(e) => setDraft({ ...draft, compactThreshold: Number(e.target.value) || 8000 })}
          />
        </label>
        <p className="hint">
          Older messages are folded into a running summary to save context and cost; the full
          transcript stays visible in the chat.
        </p>
      </section>

      <section hidden={tab !== "general"}>
        <h2>Theme</h2>
        <select
          value={draft.theme}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value as Settings["theme"] })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">System</option>
        </select>
      </section>

      {/* Web build only: the real-Linux terminal. The desktop already runs a
          native shell, so this toggle would mean nothing there. */}
      {isWebBuild() && (
        <section hidden={tab !== "general"}>
          <h2>Terminal</h2>
          <label className="check">
            <input
              type="checkbox"
              defaultChecked={localStorage.getItem("hs-web-vm") === "1"}
              onChange={(e) => localStorage.setItem("hs-web-vm", e.target.checked ? "1" : "0")}
            />
            Use a real Linux terminal (experimental)
          </label>
          <p className="hint">
            Runs commands in an actual Linux VM in your browser — real busybox, real programs —
            instead of the lightweight built-in shell. The first use downloads a ~10&nbsp;MB kernel
            and takes a few seconds to boot; after that it's instant. Your workspace files are
            shared with it both ways. Off uses the fast built-in shell.
          </p>
        </section>
      )}

      <section hidden={tab !== "data"}>
        <h2>Data</h2>
        <p className="hint">
          Export everything — settings, chats, presets, templates, tools, workflows, agents,
          schedules, knowledge bases, and MCP servers — as a single JSON backup, or restore one.
        </p>
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.[0]) void importAll(e.target.files[0]);
            e.target.value = "";
          }}
        />
        <div className="provider-row">
          <button className="btn primary" onClick={() => void exportAll()}>
            Export all data
          </button>
          <button className="btn" onClick={() => importRef.current?.click()}>
            Import backup
          </button>
        </div>
        {dataMsg && <p className="hint" style={{ marginTop: 8 }}>{dataMsg}</p>}
      </section>

      <section hidden={tab !== "data"}>
        <h2>About &amp; updates</h2>
        <p className="hint">
          HarnessStation {update ? `v${update.current}` : ""} · API keys are stored in the Windows
          Credential Manager, not in plain text.
        </p>
        <div className="provider-row">
          <button className="btn" disabled={checking} onClick={() => void runUpdateCheck()}>
            {checking ? "Checking..." : "Check for updates"}
          </button>
          {update?.available && (
            <button
              className="btn primary"
              onClick={() => void installUpdate((p) => setUpdateProgress(p))}
            >
              {updateProgress != null ? `Installing ${updateProgress}%` : `Install v${update.version}`}
            </button>
          )}
        </div>
        {update?.available && update.notes && (
          <pre className="code-view" style={{ marginTop: 8, maxHeight: 160 }}>{update.notes}</pre>
        )}
      </section>

      <section hidden={tab !== "providers"}>
        <WebLlmCard />
      </section>

      <section hidden={tab !== "providers"}>
        <h2>
          Providers{" "}
          <button className="btn small" onClick={addProvider}>
            + Add
          </button>
        </h2>
        {draft.providers.map((p) => (
          <div key={p.id} className="provider-card">
            <div className="provider-row">
              <input
                className="provider-name"
                value={p.name}
                onChange={(e) => patchProvider(p.id, { name: e.target.value })}
              />
              <select
                value={p.kind}
                onChange={(e) =>
                  patchProvider(p.id, { kind: e.target.value as Provider["kind"] })
                }
              >
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="anthropic">Anthropic</option>
                <option value="webllm">In-browser (WebGPU)</option>
              </select>
              <button
                className="icon-btn"
                title="Remove provider"
                onClick={() =>
                  setDraft({ ...draft, providers: draft.providers.filter((x) => x.id !== p.id) })
                }
              >
                ×
              </button>
            </div>
            <div className="provider-row">
              <input
                className="grow"
                value={p.baseUrl}
                placeholder="Base URL"
                onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
              />
              <input
                className="grow"
                type="password"
                value={p.apiKey}
                placeholder="API key (optional for local)"
                onChange={(e) => patchProvider(p.id, { apiKey: e.target.value })}
              />
            </div>
            <input
              value={p.models.join(", ")}
              placeholder="Models, comma-separated (or use refresh in chat panel)"
              onChange={(e) =>
                patchProvider(p.id, {
                  models: e.target.value.split(",").map((m) => m.trim()).filter(Boolean),
                })
              }
            />
            <details className="voice-tools">
              <summary>Resilience — extra keys &amp; failover</summary>
              <p className="hint" style={{ marginTop: 6 }}>
                If a request is rate-limited, rejected, or the connection fails, the app retries with
                the next spare key, then each backup provider — but only before any reply has started,
                so answers are never duplicated.
              </p>
              <label className="field">
                <span>Extra API keys (one per line, rotated on failure)</span>
                <textarea
                  rows={2}
                  spellCheck={false}
                  placeholder="sk-backup-1&#10;sk-backup-2"
                  defaultValue={(p.apiKeys ?? []).join("\n")}
                  onBlur={(e) =>
                    patchProvider(p.id, {
                      apiKeys: e.target.value.split("\n").map((k) => k.trim()).filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Backup providers (tried in order)</span>
                <div className="agent-check-grid">
                  {draft.providers
                    .filter((x) => x.id !== p.id)
                    .map((x) => (
                      <label key={x.id} className="agent-check">
                        <input
                          type="checkbox"
                          checked={(p.fallbacks ?? []).includes(x.id)}
                          onChange={() =>
                            patchProvider(p.id, {
                              fallbacks: (p.fallbacks ?? []).includes(x.id)
                                ? (p.fallbacks ?? []).filter((id) => id !== x.id)
                                : [...(p.fallbacks ?? []), x.id],
                            })
                          }
                        />
                        {x.name}
                      </label>
                    ))}
                </div>
              </label>
            </details>
            <details className="voice-tools">
              <summary>Advanced — extra request fields</summary>
              <p className="hint" style={{ marginTop: 6 }}>
                JSON merged into every request body for this provider, overriding anything the app
                sets. For backends that need non-standard options — e.g.{" "}
                <code>{'{"enable_thinking": false}'}</code> or{" "}
                <code>{'{"provider": {"order": ["deepinfra"]}}'}</code>. Leave blank for none.
              </p>
              <textarea
                rows={3}
                spellCheck={false}
                placeholder='{"top_k": 40}'
                defaultValue={p.extraBody ? JSON.stringify(p.extraBody, null, 2) : ""}
                onBlur={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) return patchProvider(p.id, { extraBody: undefined });
                  try {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                      patchProvider(p.id, { extraBody: parsed });
                      setExtraErr((s) => ({ ...s, [p.id]: "" }));
                    } else {
                      setExtraErr((s) => ({ ...s, [p.id]: "Must be a JSON object." }));
                    }
                  } catch (err) {
                    setExtraErr((s) => ({ ...s, [p.id]: (err as Error).message }));
                  }
                }}
              />
              {extraErr[p.id] && <p className="hint error-text">{extraErr[p.id]}</p>}
            </details>
          </div>
        ))}
      </section>
        </div>
      </div>
    </main>
  );
}
