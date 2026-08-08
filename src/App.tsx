import { lazy, Suspense, useEffect, useState } from "react";
import { ChatWindow } from "./components/ChatWindow";
import { ConfigPanel } from "./components/ConfigPanel";
import { Sidebar } from "./components/Sidebar";
import { SidePanel } from "./components/SidePanel";

// Only the chat view is needed to paint the first frame; the other 14 views (and
// the heavy libraries they pull in) load the first time you open them.
const DiscoverView = lazy(() => import("./components/DiscoverView").then((m) => ({ default: m.DiscoverView })));
const ModelsView = lazy(() => import("./components/ModelsView").then((m) => ({ default: m.ModelsView })));
const SettingsView = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
const ToolsView = lazy(() => import("./components/ToolsView").then((m) => ({ default: m.ToolsView })));
const WorkflowsView = lazy(() => import("./components/WorkflowsView").then((m) => ({ default: m.WorkflowsView })));
const AgentsView = lazy(() => import("./components/AgentsView").then((m) => ({ default: m.AgentsView })));
const SchedulesView = lazy(() => import("./components/SchedulesView").then((m) => ({ default: m.SchedulesView })));
const CompareView = lazy(() => import("./components/CompareView").then((m) => ({ default: m.CompareView })));
const KnowledgeView = lazy(() => import("./components/KnowledgeView").then((m) => ({ default: m.KnowledgeView })));
const SkillsView = lazy(() => import("./components/SkillsView").then((m) => ({ default: m.SkillsView })));
const EvalsView = lazy(() => import("./components/EvalsView").then((m) => ({ default: m.EvalsView })));
const BenchmarksView = lazy(() => import("./components/BenchmarksView").then((m) => ({ default: m.BenchmarksView })));
const McpView = lazy(() => import("./components/McpView").then((m) => ({ default: m.McpView })));
const CommunityView = lazy(() => import("./components/CommunityView").then((m) => ({ default: m.CommunityView })));
const BrowserView = lazy(() => import("./components/BrowserView").then((m) => ({ default: m.BrowserView })));
const VoiceView = lazy(() => import("./components/VoiceView").then((m) => ({ default: m.VoiceView })));
import { DialogHost } from "./components/Dialog";
import { ContextMenu } from "./components/ContextMenu";
import { Toaster } from "./components/Toaster";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding, hasOnboarded } from "./components/Onboarding";
import { hasDeepLink } from "./lib/deeplink";
import { ClosingOverlay, Splash, ViewLoading } from "./components/Loading";
import { useStore } from "./lib/store";
import { flushChatSaves } from "./lib/storage";
import "./App.css";

/** Named so a view switch says what's arriving, not just "Loading…". */
const VIEW_LABEL: Partial<Record<string, string>> = {
  voice: "Opening the voice avatar…",
  settings: "Opening settings…",
  models: "Loading your models…",
  discover: "Opening Discover…",
  tools: "Loading tools…",
  workflows: "Loading workflows…",
  agents: "Loading agents…",
  schedules: "Loading schedules…",
  benchmarks: "Loading benchmarks…",
  compare: "Opening Compare…",
  evals: "Loading evals…",
  knowledge: "Loading knowledge bases…",
  skills: "Loading skills…",
  mcp: "Loading MCP servers…",
  community: "Opening the community library…",
  browser: "Opening browser control…",
};

export default function App() {
  const { ready, view, settings, init, tickSchedules, autoConnectMcp, bootStatus } = useStore();
  const [, setForce] = useState(0);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    void init().then(async () => {
      autoConnectMcp();
      // A shared link can open the app already pointed at a provider/model/style
      // (and optionally carrying a key). Apply it once settings are loaded.
      const { readDeepLink, applyDeepLink, startUrlSync } = await import("./lib/deeplink");
      const cfg = readDeepLink();
      if (cfg) await applyDeepLink(cfg);
      // Then keep the address bar mirroring the current selection.
      return startUrlSync();
    });
  }, [init, autoConnectMcp]);

  useEffect(() => {
    if (!ready) return;
    void tickSchedules();
    const t = setInterval(() => void tickSchedules(), 60_000);
    return () => clearInterval(t);
  }, [ready, tickSchedules]);

  // Chat writes are batched while streaming — make sure the tail lands on disk
  // if the window is closed mid-reply.
  useEffect(() => {
    const flush = () => void flushChatSaves();
    // On the way out, say what's happening rather than appearing to hang: the
    // batched chat writes can take a moment to land.
    const onUnload = () => {
      setClosing(true);
      flush();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", flush);
    };
  }, []);

  // Global quick-entry hotkey (Ctrl+Shift+Space) — focus a fresh chat.
  useEffect(() => {
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("quick-entry", () => {
        useStore.getState().newChat();
        setTimeout(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus(), 50);
      }).then((f) => (un = f)),
    );
    return () => un?.();
  }, []);

  // Tray "Talk to avatar" opens the voice view.
  useEffect(() => {
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("tray-voice", () => useStore.getState().setView("voice")).then((f) => (un = f)),
    );
    return () => un?.();
  }, []);

  // Cloud sync: when an account is signed in with auto-sync on, keep pushing
  // local changes up (debounced). We do NOT auto-pull on boot — that could
  // overwrite edits made offline; a pull happens on login and via "Restore".
  useEffect(() => {
    if (!ready) return;
    if (settings.cloud?.enabled && settings.cloud.token && (settings.cloud.autoSync ?? true)) {
      void import("./lib/cloud").then((m) => m.startAutoSync());
    } else {
      void import("./lib/cloud").then((m) => m.stopAutoSync());
    }
  }, [ready, settings.cloud?.enabled, settings.cloud?.token, settings.cloud?.autoSync]);

  // Messaging channels (Telegram / Discord) connect while the desktop app runs.
  // Re-sync whenever their config changes; never on the web build (bot APIs need
  // direct, non-CORS access).
  useEffect(() => {
    if (!ready) return;
    if ((globalThis as unknown as { __HS_WEB__?: boolean }).__HS_WEB__) return;
    void import("./lib/channels").then((m) => m.syncChannels(settings.channels));
  }, [ready, settings.channels]);

  // Mirror the background-mode setting into Rust, which owns the close behaviour.
  useEffect(() => {
    if (!ready) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_background_mode", { enabled: settings.backgroundMode ?? true }).catch(() => {}),
    );
  }, [ready, settings.backgroundMode]);

  // Keep today's spend on the tray tooltip so it's visible while minimised.
  useEffect(() => {
    if (!ready) return;
    void import("./lib/budget").then(({ syncTray, onSpendChange }) => {
      void syncTray();
      onSpendChange(() => void syncTray());
    });
  }, [ready]);

  // Prevent the webview from navigating away when a file is dropped outside the input.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".input-row")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // Let the browser tools open the in-conversation browser themselves. A model
  // told to open a page shouldn't need the user to have opened the card first.
  useEffect(() => {
    void import("./lib/browserPane").then(({ registerPaneRequester }) =>
      registerPaneRequester(() => useStore.getState().setBrowserDock(true)),
    );
    return () => {
      void import("./lib/browserPane").then(({ registerPaneRequester }) =>
        registerPaneRequester(null),
      );
    };
  }, []);

  // Bring the device mesh up if the user asked for it. Deliberately after the
  // first render: it binds a network port, and a machine that can't bind one
  // should still get a working app.
  useEffect(() => {
    if (localStorage.getItem("hs-mesh-auto") !== "1") return;
    let stopped = false;
    void import("./lib/meshRuntime").then(({ startMesh }) => {
      if (!stopped) void startMesh().catch(() => {});
    });
    return () => {
      stopped = true;
      void import("./lib/meshRuntime").then(({ stopMesh }) => void stopMesh().catch(() => {}));
    };
  }, []);

  // Local OpenAI-compatible API server, if the user turned it on (desktop only).
  // Reacts to the toggle and port so changing either restarts the server.
  useEffect(() => {
    const cfg = settings.localApi;
    if (!cfg?.enabled) return;
    let stopped = false;
    void import("./lib/localApi").then(({ startLocalApi, DEFAULT_LOCAL_API_PORT }) => {
      if (stopped) return;
      void startLocalApi(cfg.port ?? DEFAULT_LOCAL_API_PORT).catch((e) =>
        console.warn("Local API server couldn't start:", e),
      );
    });
    return () => {
      stopped = true;
      void import("./lib/localApi").then(({ stopLocalApi }) => void stopLocalApi().catch(() => {}));
    };
  }, [settings.localApi?.enabled, settings.localApi?.port]);

  useEffect(() => {
    const theme =
      settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : settings.theme;
    document.documentElement.dataset.theme = theme;
  }, [settings.theme]);

  if (!ready) return <Splash status={bootStatus} />;

  // Arriving via a share link means the setup is already chosen — don't block it
  // with the getting-started chooser.
  const showOnboard = !hasOnboarded() && !hasDeepLink();

  return (
    <div className="app">
      <Sidebar />
      <Suspense fallback={<ViewLoading label={VIEW_LABEL[view] ?? "Loading…"} />}>
      {view === "voice" ? (
        <VoiceView />
      ) : view === "settings" ? (
        <SettingsView />
      ) : view === "models" ? (
        <ModelsView />
      ) : view === "discover" ? (
        <DiscoverView />
      ) : view === "tools" ? (
        <ToolsView />
      ) : view === "workflows" ? (
        <WorkflowsView />
      ) : view === "agents" ? (
        <AgentsView />
      ) : view === "schedules" ? (
        <SchedulesView />
      ) : view === "benchmarks" ? (
        <BenchmarksView />
      ) : view === "compare" ? (
        <CompareView />
      ) : view === "evals" ? (
        <EvalsView />
      ) : view === "knowledge" ? (
        <KnowledgeView />
      ) : view === "skills" ? (
        <SkillsView />
      ) : view === "mcp" ? (
        <McpView />
      ) : view === "community" ? (
        <CommunityView />
      ) : view === "browser" ? (
        <BrowserView />
      ) : (
        <>
          <ChatWindow />
          <SidePanel />
          <ConfigPanel />
        </>
      )}
      </Suspense>
      <DialogHost />
      <ContextMenu />
      <Toaster />
      <CommandPalette />
      {showOnboard && <Onboarding onClose={() => setForce((n) => n + 1)} />}
      {closing && <ClosingOverlay />}
    </div>
  );
}
