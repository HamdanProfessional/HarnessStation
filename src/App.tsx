import { Suspense, useEffect, useState } from "react";
import { ChatWindow } from "./components/ChatWindow";
import { ConfigPanel } from "./components/ConfigPanel";
import { Sidebar } from "./components/Sidebar";
import { SidePanel } from "./components/SidePanel";
// Only the chat view is needed to paint the first frame; every other view (and
// the heavy libraries they pull in) lazy-loads on first open, registered in
// lib/views. App renders whichever view id is active from that one registry.
import { VIEW_BY_ID } from "./lib/views";
import { DialogHost } from "./components/Dialog";
import { ContextMenu } from "./components/ContextMenu";
import { Toaster } from "./components/Toaster";
import { CommandPalette } from "./components/CommandPalette";
// The getting-started modal used to open here on first run. It was a chooser in
// front of a chooser: pick a path, land in Discover, pick a provider, then find
// your way back to a chat. New users now start *in* the conversation with an
// inline key prompt (see ChatWindow's empty state), which is the same decision
// with four fewer steps. Onboarding.tsx is kept for reference until the flow has
// been seen by real users.
import { IconPanelLeft, IconPanelRight } from "./components/icons";
import { ClosingOverlay, Splash, ViewLoading } from "./components/Loading";
import { useStore } from "./lib/store";
import { flushChatSaves } from "./lib/storage";
import { installWatchdog } from "./lib/watchdog";
import { toast } from "./lib/toast";
import "./App.css";

export default function App() {
  const {
    ready,
    view,
    settings,
    init,
    tickSchedules,
    autoConnectMcp,
    bootStatus,
    sidebarOpen,
    setSidebarOpen,
    configOpen,
    setConfigOpen,
  } = useStore();
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
  // The session token lives in the keychain now, so "signed in" is judged by
  // the account flags alone; pushNow re-checks the token itself.
  useEffect(() => {
    if (!ready) return;
    if (settings.cloud?.enabled && (settings.cloud.autoSync ?? true)) {
      void import("./lib/cloud").then((m) => m.startAutoSync());
    } else {
      void import("./lib/cloud").then((m) => m.stopAutoSync());
    }
  }, [ready, settings.cloud?.enabled, settings.cloud?.autoSync]);

  // Messaging channels (Telegram / Discord) connect while the desktop app runs.
  // Re-sync whenever their config changes; never on the web build (bot APIs need
  // direct, non-CORS access).
  useEffect(() => {
    if (!ready) return;
    if ((globalThis as unknown as { __HS_WEB__?: boolean }).__HS_WEB__) return;
    void import("./lib/channels").then((m) => m.syncChannels(settings.channels));
  }, [ready, settings.channels]);

  // Answer the hang watchdog, and report a hang from the previous run.
  //
  // Not gated on `ready`: a hang during hydration is exactly the case worth
  // catching, and waiting for the store would leave the riskiest stretch of
  // startup unwatched.
  useEffect(() => {
    void installWatchdog((message) => toast.error(message));
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

  // The accent palette is independent of the canvas so a user can pick
  // "light + forest" without us shipping a combinatorial matrix. Defaults to
  // indigo when unset (early installs, partial settings.json).
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent ?? "indigo";
  }, [settings.accent]);

  if (!ready) return <Splash status={bootStatus} />;

  return (
    <div className={`app${sidebarOpen ? "" : " left-collapsed"}${configOpen ? "" : " right-collapsed"}`}>
      {/* Kept mounted when collapsed so it can slide out instead of vanishing:
          unmounting removed 262px of layout in a single frame and threw the
          whole view sideways. CSS slides it under its own edge and then flips
          it to visibility:hidden, which is what takes it out of the tab order —
          see `.app.left-collapsed .sidebar`. The reopen handle is
          position:fixed, so it can coexist without affecting the row. */}
      <Sidebar />
      {!sidebarOpen && (
        <button
          className="rail-reopen left"
          title="Show sidebar"
          aria-label="Show sidebar"
          onClick={() => setSidebarOpen(true)}
        >
          <IconPanelLeft size={16} />
        </button>
      )}
      <Suspense fallback={<ViewLoading label={VIEW_BY_ID[view]?.loadLabel ?? "Loading…"} />}>
      {(() => {
        const def = VIEW_BY_ID[view];
        if (def) {
          const ViewComponent = def.Component;
          return <ViewComponent />;
        }
        // Default surface: the chat, with its side and config panels.
        return (
          <>
            <ChatWindow />
            <SidePanel />
            {/* Same treatment as the sidebar — slide, don't disappear. */}
            <ConfigPanel />
            {!configOpen && (
              <button
                className="rail-reopen right"
                title="Show settings panel"
                aria-label="Show settings panel"
                onClick={() => setConfigOpen(true)}
              >
                <IconPanelRight size={16} />
              </button>
            )}
          </>
        );
      })()}
      </Suspense>
      <DialogHost />
      <ContextMenu />
      <Toaster />
      <CommandPalette />
      {closing && <ClosingOverlay />}
    </div>
  );
}
