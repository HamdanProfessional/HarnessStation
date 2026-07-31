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
const VoiceView = lazy(() => import("./components/VoiceView").then((m) => ({ default: m.VoiceView })));
import { DialogHost } from "./components/Dialog";
import { ContextMenu } from "./components/ContextMenu";
import { Toaster } from "./components/Toaster";
import { CommandPalette } from "./components/CommandPalette";
import { Onboarding, hasOnboarded } from "./components/Onboarding";
import { useStore } from "./lib/store";
import { flushChatSaves } from "./lib/storage";
import "./App.css";

export default function App() {
  const { ready, view, settings, init, tickSchedules, autoConnectMcp } = useStore();
  const [, setForce] = useState(0);

  useEffect(() => {
    void init().then(() => autoConnectMcp());
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
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
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

  useEffect(() => {
    const theme =
      settings.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : settings.theme;
    document.documentElement.dataset.theme = theme;
  }, [settings.theme]);

  if (!ready) return <div className="loading">Loading…</div>;

  const showOnboard = !hasOnboarded();

  return (
    <div className="app">
      <Sidebar />
      <Suspense fallback={<div className="loading">Loading…</div>}>
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
    </div>
  );
}
