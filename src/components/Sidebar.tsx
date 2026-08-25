import { useEffect, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import { useStore, type View } from "../lib/store";
import { useModal } from "../lib/useModal";
import * as storage from "../lib/storage";
import type { SnapshotInfo } from "../lib/storage";
import { searchChats, type ChatSearchHit } from "../lib/chatSearch";
import { NAV_VIEWS, type NavSection } from "../lib/views";
import {
  IconChat,
  IconDots,
  IconGear,
  IconPlus,
  IconSearch,
  IconSpeaker,
  LogoMark,
  IconChevron,
  IconPanelLeft,
  IconX,
  IconSun,
  IconMoon,
  IconShield,
} from "./icons";
import { NotificationBell } from "./NotificationBell";

const NAV_SECTIONS: { key: NavSection; title: string }[] = [
  { key: "library", title: "Library" },
  { key: "automation", title: "Automation" },
];

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function Sidebar() {
  const {
    chats,
    currentId,
    selectChat,
    newChat,
    deleteChat,
    renameChat,
    togglePin,
    setChatFolder,
    duplicateChat,
    snapshotChat,
    restoreSnapshot,
    exportChat,
    setView,
    view,
    messageCounts,
    hydrateAllChats,
    newVoiceCall,
    activeVoiceChat,
    projects,
    activeProjectId,
    setActiveProject,
    saveProject,
    deleteProject,
    newProjectChat,
    setSidebarOpen,
    settings,
    saveSettings,
  } = useStore();
  // Active profile hides whole views/sections from the nav (see lib/views).
  const activeProfile = settings.profiles?.find((p) => p.id === settings.activeProfileId);
  const hiddenViews = new Set<string>(activeProfile?.hiddenViews ?? []);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [snapsFor, setSnapsFor] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<SnapshotInfo[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("hs-nav-collapsed") ?? "{}");
    } catch {
      return {};
    }
  });

  const toggleSection = (key: string) => {
    setCollapsed((c) => {
      const next = { ...c, [key]: !c[key] };
      localStorage.setItem("hs-nav-collapsed", JSON.stringify(next));
      return next;
    });
  };

  const snapsModalRef = useModal(!!snapsFor, () => setSnapsFor(null));

  useEffect(() => {
    if (!snapsFor) return;
    void storage.listSnapshots(snapsFor).then(setSnaps);
  }, [snapsFor]);

  // Transcripts load on demand, so searching content needs them all in memory.
  // Paid once, on the first search of the session — and it also feeds the
  // semantic pass, which builds its snippets from the same bodies.
  useEffect(() => {
    if (query.trim()) void hydrateAllChats();
  }, [query, hydrateAllChats]);

  const q = query.toLowerCase();
  // A project acts as a lens on the chat list: inside one you see only its work.
  const inScope = activeProjectId
    ? chats.filter((c) => c.projectId === activeProjectId)
    : chats;
  const filtered = (
    q
      ? inScope.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => m.content.toLowerCase().includes(q)),
        )
      : inScope
  )
    .slice()
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  // ---------- semantic search ----------
  //
  // The substring list above is the fast path and stays authoritative. Behind
  // it, once the transcripts are in memory, chats that mean what you typed but
  // don't literally say it are ranked by embedding similarity. Debounced so
  // typing doesn't queue a model call per keystroke; cancelled on unmount or
  // query change so a slow pass can't land stale results.
  const [semHits, setSemHits] = useState<ChatSearchHit[]>([]);
  const [semEmbedded, setSemEmbedded] = useState(true);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setSemHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        await hydrateAllChats();
        // Read fresh state: the component's `chats` is a render-time snapshot,
        // and hydration just filled in the bodies we're about to embed.
        const { chats: fresh } = useStore.getState();
        const scope = activeProjectId
          ? fresh.filter((c) => c.projectId === activeProjectId)
          : fresh;
        const res = await searchChats(scope, needle);
        if (cancelled) return;
        setSemHits(res.semantic);
        setSemEmbedded(res.embedded);
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, activeProjectId, hydrateAllChats]);

  const rootChats = filtered.filter((c) => !c.folder);
  const byFolder: Record<string, typeof filtered> = {};
  for (const c of filtered) if (c.folder) (byFolder[c.folder] ??= []).push(c);
  const folderNames = Object.keys(byFolder).sort();

  const chatItem = (c: (typeof filtered)[number], badge?: string) => (
    // Not a <button>: it contains the options button, and nested buttons are
    // invalid HTML. role + tabIndex + a key handler gets the same behaviour.
    <div
      key={c.id}
      role="button"
      tabIndex={0}
      aria-current={c.id === currentId && view === "chat" ? "true" : undefined}
      className={`chat-item ${c.id === currentId && view === "chat" ? "active" : ""}`}
      onClick={() => selectChat(c.id)}
      onKeyDown={(e) => {
        // Space scrolls the list by default, which is not what pressing a
        // control should do.
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectChat(c.id);
        }
      }}
    >
      <span className="chat-icon">
        {c.kind === "voice" || c.voiceMode ? <IconSpeaker size={14} /> : <IconChat size={14} />}
      </span>
      <span className="chat-text">
        <span className="chat-title">
          {c.pinned && <span className="pin-dot" title="Pinned">•</span>}
          {c.title}
        </span>
        <span className="chat-sub">
          {c.id === activeVoiceChat ? <span className="live-dot" title="Call in progress" /> : null}
          {c.voiceMode && c.id !== activeVoiceChat ? "Voice · " : ""}
          {c.kind === "voice" && !c.voiceMode ? "Call · " : ""}
          {c.id === activeVoiceChat ? "On call · " : ""}
          {relTime(c.updatedAt)}
          {/* Loaded chats know their own length; the rest come from the index. */}
          {(c.messages.length || messageCounts[c.id] || 0) > 0 &&
            ` · ${c.messages.length || messageCounts[c.id]} msg`}
        </span>
      </span>
      {badge && (
        <span className="sem-score" title="Semantic similarity">
          {badge}
        </span>
      )}
      <button
        className="icon-btn chat-menu-btn"
        title="Chat options"
        aria-label={`Options for ${c.title}`}
        aria-expanded={menuFor?.id === c.id}
        onClick={(e) => {
          e.stopPropagation();
          if (menuFor?.id === c.id) {
            setMenuFor(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const MENU_H = 320;
          const top =
            rect.bottom + MENU_H > window.innerHeight
              ? Math.max(8, window.innerHeight - MENU_H - 8)
              : rect.bottom + 4;
          setMenuFor({ id: c.id, top, left: rect.left });
        }}
      >
        <IconDots size={14} />
      </button>
    </div>
  );

  const menuAction = async (id: string, action: string) => {
    setMenuFor(null);
    if (action === "rename") {
      const chat = chats.find((c) => c.id === id);
      const title = await promptDialog("Rename chat", { defaultValue: chat?.title ?? "" });
      if (title?.trim()) await renameChat(id, title.trim());
    } else if (action === "pin") {
      await togglePin(id);
    } else if (action === "folder") {
      const chat = chats.find((c) => c.id === id);
      const folder = await promptDialog("Move to folder", {
        message: "Folder name (leave blank to remove from folder)",
        defaultValue: chat?.folder ?? "",
      });
      if (folder !== null) await setChatFolder(id, folder.trim());
    } else if (action === "duplicate") {
      await duplicateChat(id);
    } else if (action === "snapshot") {
      await snapshotChat(id);
    } else if (action === "snapshots") {
      setSnapsFor(id);
    } else if (action === "export-md" || action === "export-json" || action === "export-jsonl") {
      const fmt = action === "export-md" ? "md" : action === "export-jsonl" ? "jsonl" : "json";
      const rel = await exportChat(id, fmt);
      toast.success(`Exported to ~\\.harnessx\\${rel.replace("/", "\\")}`);
    } else if (action === "delete") {
      if (await confirmDialog("Delete this chat?", { danger: true })) await deleteChat(id);
    }
  };

  const addProject = async () => {
    const name = await promptDialog("New project", { placeholder: "e.g. Firmware rewrite" });
    if (!name?.trim()) return;
    const now = new Date().toISOString();
    const id = `proj-${Date.now()}`;
    await saveProject({
      id,
      name: name.trim(),
      description: "",
      instructions: "",
      createdAt: now,
      updatedAt: now,
    });
    setActiveProject(id);
  };

  const removeProject = async (id: string, name: string) => {
    const ok = await confirmDialog(`Delete project "${name}"?`, {
      message:
        "Its chats are kept and moved out of the project. The project's shared memory is deleted; your global and per-chat memory are untouched.",
      danger: true,
    });
    if (ok) await deleteProject(id);
  };

  // Cycle dark → light → system → dark. The icon shows the *current* state so the
  // button reads as a state indicator as well as an action.
  const cycleTheme = () => {
    const next = settings.theme === "dark" ? "light" : settings.theme === "light" ? "system" : "dark";
    void saveSettings({ ...settings, theme: next });
  };
  const themeIcon = settings.theme === "light" ? <IconSun size={14} /> : <IconMoon size={14} />;
  const themeLabel =
    settings.theme === "dark" ? "Theme: dark (click for light)" :
    settings.theme === "light" ? "Theme: light (click for system)" :
    "Theme: follows system (click for dark)";

  const navBtn = (v: View, label: string, icon: React.ReactNode) => (
    <button key={v} className={`nav-btn ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
      <span className="nav-icon">{icon}</span>
      {label}
    </button>
  );

  return (
    <aside className="sidebar" onClick={() => setMenuFor(null)}>
      <div className="sidebar-header">
        <LogoMark />
        <span className="logo">HarnessStation</span>
        <NotificationBell />
        <button
          className="icon-btn"
          title={themeLabel}
          aria-label={themeLabel}
          onClick={cycleTheme}
        >
          {themeIcon}
        </button>
        <button
          className="icon-btn sidebar-collapse"
          title="Hide sidebar"
          aria-label="Hide sidebar"
          onClick={() => setSidebarOpen(false)}
        >
          <IconPanelLeft size={15} />
        </button>
      </div>

      {/* The privacy claim is the product's one uncopyable differentiator, so it
          is stated where it is always visible rather than left in PRIVACY.md
          for the few who go looking. */}
      <button
        className="trust-badge"
        title="Local-first. No account. No telemetry. Your keys stay in your OS keychain. Your chats never leave your machine."
        onClick={() => setView("settings")}
      >
        <IconShield size={12} />
        We don&apos;t see your chats
      </button>

      <div className="new-row">
        <button className="btn primary new-chat-btn" onClick={newChat}>
          <IconPlus size={14} /> New chat
        </button>
        <button
          className="btn new-call-btn"
          onClick={newVoiceCall}
          title="Start a voice call with the avatar"
        >
          <IconSpeaker size={14} /> New call
        </button>
      </div>

      <div className="search-wrap">
        <span className="search-icon">
          <IconSearch size={14} />
        </span>
        <input
          className="search"
          placeholder="Search chats..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          title="Matches titles and message text. Also searches by meaning once an embeddings model is set (Settings → Providers)."
        />
      </div>

      {/* Everything between the search box and Settings scrolls as one region.
          Previously each part sized itself, so with every section expanded the
          list simply grew past the bottom of the window and Settings went with
          it — unreachable, with nothing to scroll. */}
      <div className="sidebar-scroll">
      <div className="nav-section">
        <button
          className="nav-section-title"
          onClick={() => toggleSection("projects")}
          aria-expanded={!collapsed.projects}
        >
          <span className={`nav-caret ${collapsed.projects ? "closed" : ""}`} aria-hidden="true">
            <IconChevron size={13} />
          </span>
          Projects
          <span className="grow" />
          <span
            className="link-btn"
            role="button"
            tabIndex={0}
            title="New project"
            onClick={(e) => {
              e.stopPropagation();
              void addProject();
            }}
            onKeyDown={(e) => e.key === "Enter" && void addProject()}
          >
            +
          </span>
        </button>
        {!collapsed.projects && (
          <>
            {projects.length === 0 && (
              <p className="hint project-empty">
                Group chats and calls that share a brief and a memory.
              </p>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`project-item ${p.id === activeProjectId ? "active" : ""}`}
                onClick={() => setActiveProject(p.id === activeProjectId ? null : p.id)}
              >
                <span className="grow">{p.name}</span>
                <span className="hint">{chats.filter((c) => c.projectId === p.id).length}</span>
                <button
                  className="icon-btn"
                  aria-label={`New chat in ${p.name}`}
                  title="New chat in this project"
                  onClick={(e) => {
                    e.stopPropagation();
                    newProjectChat(p.id);
                  }}
                >
                  <IconPlus size={12} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Delete project ${p.name}`}
                  title="Delete project"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeProject(p.id, p.name);
                  }}
                >
                  <IconX size={13} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <button
        className="nav-section-title"
        onClick={() => toggleSection("chats")}
        aria-expanded={!collapsed.chats}
      >
        <span className={`nav-caret ${collapsed.chats ? "closed" : ""}`} aria-hidden="true">
          <IconChevron size={13} />
        </span>
        {activeProjectId
          ? `Chats in ${projects.find((p) => p.id === activeProjectId)?.name ?? "project"}`
          : "Chats"}
        <span className="grow" />
        <span className="tool-group-count">{filtered.length}</span>
      </button>
      {/* Rendered conditionally, like every other section. The `hidden`
          attribute was silently doing nothing here: .chat-list sets
          `display: flex`, and a class selector outranks the user-agent's
          `[hidden] { display: none }`. */}
      {!collapsed.chats && (
      <div className="chat-list">
        {filtered.length === 0 && <div className="hint chat-empty">No chats found.</div>}
        {/* Explicit arrow: .map(chatItem) would pass the array index as the badge. */}
        {rootChats.map((c) => chatItem(c))}
        {folderNames.map((f) => {
          const open = !collapsed[`folder:${f}`];
          return (
            <div key={f} className="chat-folder">
              <button
                className="chat-folder-head"
                onClick={() => toggleSection(`folder:${f}`)}
                aria-expanded={open}
              >
                <span className={`nav-caret ${open ? "" : "closed"}`} aria-hidden="true">
                  <IconChevron size={12} />
                </span>
                {f}
                <span className="tool-group-count">{byFolder[f].length}</span>
              </button>
              {open && byFolder[f].map((c) => chatItem(c))}
            </div>
          );
        })}
        {q.trim() && semHits.length > 0 && (
          <>
            <div className="sem-head">Semantic matches</div>
            {semHits.map((h) => {
              const c = chats.find((x) => x.id === h.id);
              if (!c) return null;
              return (
                <Fragment key={h.id}>
                  {chatItem(c, `${Math.round(h.score * 100)}%`)}
                </Fragment>
              );
            })}
          </>
        )}
        {/* Only speak up when the fast path came up empty — otherwise this would
            nag everyone whose provider was never configured, on every search. */}
        {q.trim() && filtered.length === 0 && !semEmbedded && (
          <div className="hint chat-empty">
            No matches. Set an embeddings model in Settings → Models for meaning-based search.
          </div>
        )}
      </div>
      )}

      {menuFor &&
        createPortal(
          <>
            <div className="menu-overlay" onClick={() => setMenuFor(null)} />
            <div
              className="menu menu-floating"
              style={{ top: menuFor.top, left: menuFor.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <button onClick={() => void menuAction(menuFor.id, "pin")}>
                {chats.find((c) => c.id === menuFor.id)?.pinned ? "Unpin" : "Pin"}
              </button>
              <button onClick={() => void menuAction(menuFor.id, "rename")}>Rename</button>
              <button onClick={() => void menuAction(menuFor.id, "folder")}>Move to folder...</button>
              <button onClick={() => void menuAction(menuFor.id, "duplicate")}>Duplicate</button>
              <button onClick={() => void menuAction(menuFor.id, "snapshot")}>Take snapshot</button>
              <button onClick={() => void menuAction(menuFor.id, "snapshots")}>Snapshots...</button>
              <button onClick={() => void menuAction(menuFor.id, "export-md")}>Export Markdown</button>
              <button onClick={() => void menuAction(menuFor.id, "export-json")}>Export JSON</button>
              <button onClick={() => void menuAction(menuFor.id, "export-jsonl")}>Export trace (JSONL)</button>
              <button className="danger-item" onClick={() => void menuAction(menuFor.id, "delete")}>
                Delete
              </button>
            </div>
          </>,
          document.body,
        )}


      {NAV_SECTIONS.map((sec) => {
        // Registry-driven nav: every view lives in lib/views, filtered here by
        // the active profile so a profile can hide whole sections/panels.
        const items = NAV_VIEWS.filter((v) => v.section === sec.key && !hiddenViews.has(v.id));
        if (!items.length) return null;
        return (
          <div className="nav-section" key={sec.key}>
            <button
              className="nav-section-title"
              onClick={() => toggleSection(sec.key)}
              aria-expanded={!collapsed[sec.key]}
            >
              <span className={`nav-caret ${collapsed[sec.key] ? "closed" : ""}`} aria-hidden="true">
                <IconChevron size={13} />
              </span>
              {sec.title}
            </button>
            {!collapsed[sec.key] && (
              <>
                {items.map((v) => {
                  const Icon = v.Icon!;
                  return navBtn(v.id, v.label, <Icon size={15} />);
                })}
              </>
            )}
          </div>
        );
      })}
      {/* A profile hides views rather than removing them, so the way back has to
          be visible — a feature you can't find is the same as one that isn't
          there. Shown only while something is actually hidden. */}
      {hiddenViews.size > 0 && (
        <div className="nav-section">
          <button
            className="nav-btn nav-more"
            title="Show every view in the sidebar"
            onClick={() => void saveSettings({ ...settings, activeProfileId: undefined })}
          >
            <span className="nav-ico" aria-hidden="true">
              <IconPlus size={15} />
            </span>
            Show all features
            <span className="nav-count">{hiddenViews.size}</span>
          </button>
        </div>
      )}
      </div>

      {/* Pinned below the scroll region, so it's always one click away. */}
      <div className="nav-section sidebar-foot">
        {navBtn("settings", "Settings", <IconGear size={15} />)}
      </div>

      {snapsFor &&
        createPortal(
        <div className="modal-backdrop" onClick={() => setSnapsFor(null)}>
          <div
            className="modal"
            ref={snapsModalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Snapshots"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Snapshots</h3>
            {snaps.length === 0 && <p className="hint">No snapshots for this chat yet.</p>}
            {snaps.map((s) => (
              <div key={s.file} className="provider-row">
                <span className="grow">{s.takenAt}</span>
                <button
                  className="btn small"
                  onClick={() => {
                    void restoreSnapshot(s.file);
                    setSnapsFor(null);
                  }}
                >
                  Restore
                </button>
                <button
                  className="icon-btn"
                  title="Delete snapshot"
                  aria-label={`Delete snapshot ${s.file}`}
                  onClick={() => {
                    void storage.deleteSnapshot(s.file).then(() =>
                      storage.listSnapshots(snapsFor).then(setSnaps),
                    );
                  }}
                >
                  <IconX size={12} />
                </button>
              </div>
            ))}
            <button className="btn" onClick={() => setSnapsFor(null)}>
              Close
            </button>
          </div>
        </div>,
        document.body,
      )}
    </aside>
  );
}
