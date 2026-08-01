import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import { useStore, type View } from "../lib/store";
import { useModal } from "../lib/useModal";
import * as storage from "../lib/storage";
import type { SnapshotInfo } from "../lib/storage";
import {
  IconAgent,
  IconBook,
  IconBox,
  IconChart,
  IconChat,
  IconColumns,
  IconCompass,
  IconGrid,
  IconDots,
  IconFlow,
  IconGear,
  IconPlug,
  IconPlus,
  IconClock,
  IconSearch,
  IconSpeaker,
  IconWrench,
  LogoMark,
} from "./icons";
import { NotificationBell } from "./NotificationBell";

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
    browserDock,
    setBrowserDock,
  } = useStore();
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
  // Paid once, on the first search of the session.
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

  const rootChats = filtered.filter((c) => !c.folder);
  const byFolder: Record<string, typeof filtered> = {};
  for (const c of filtered) if (c.folder) (byFolder[c.folder] ??= []).push(c);
  const folderNames = Object.keys(byFolder).sort();

  const chatItem = (c: (typeof filtered)[number]) => (
    <div
      key={c.id}
      className={`chat-item ${c.id === currentId && view === "chat" ? "active" : ""}`}
      onClick={() => selectChat(c.id)}
    >
      <span className="chat-icon">
        {c.kind === "voice" ? <IconSpeaker size={14} /> : <IconChat size={14} />}
      </span>
      <span className="chat-text">
        <span className="chat-title">
          {c.pinned && <span className="pin-dot" title="Pinned">•</span>}
          {c.title}
        </span>
        <span className="chat-sub">
          {c.id === activeVoiceChat ? <span className="live-dot" title="Call in progress" /> : null}
          {c.kind === "voice" ? "Call · " : ""}
          {relTime(c.updatedAt)}
          {/* Loaded chats know their own length; the rest come from the index. */}
          {(c.messages.length || messageCounts[c.id] || 0) > 0 &&
            ` · ${c.messages.length || messageCounts[c.id]} msg`}
        </span>
      </span>
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
    } else if (action === "export-md" || action === "export-json") {
      const rel = await exportChat(id, action === "export-md" ? "md" : "json");
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

  const navBtn = (v: View, label: string, icon: React.ReactNode) => (
    <button className={`nav-btn ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
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
      </div>

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
        />
      </div>

      <div className="nav-section">
        <button
          className="nav-section-title"
          onClick={() => toggleSection("projects")}
          aria-expanded={!collapsed.projects}
        >
          <span className={`nav-caret ${collapsed.projects ? "closed" : ""}`} aria-hidden="true">
            ▾
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
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="nav-section-title">
        {activeProjectId
          ? `Chats in ${projects.find((p) => p.id === activeProjectId)?.name ?? "project"}`
          : "Chats"}
      </div>
      <div className="chat-list">
        {filtered.length === 0 && <div className="hint chat-empty">No chats found.</div>}
        {rootChats.map(chatItem)}
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
                  ▾
                </span>
                {f}
                <span className="tool-group-count">{byFolder[f].length}</span>
              </button>
              {open && byFolder[f].map(chatItem)}
            </div>
          );
        })}
      </div>

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
              <button className="danger-item" onClick={() => void menuAction(menuFor.id, "delete")}>
                Delete
              </button>
            </div>
          </>,
          document.body,
        )}


      <div className="nav-section">
        <button
          className="nav-section-title"
          onClick={() => toggleSection("library")}
          aria-expanded={!collapsed.library}
        >
          <span className={`nav-caret ${collapsed.library ? "closed" : ""}`} aria-hidden="true">
            ▾
          </span>
          Library
        </button>
        {!collapsed.library && (
          <>
            {navBtn("discover", "Discover", <IconCompass size={15} />)}
            {navBtn("models", "My Models", <IconBox size={15} />)}
            {navBtn("compare", "Compare", <IconColumns size={15} />)}
            {navBtn("evals", "Evals", <IconGrid size={15} />)}
            {navBtn("benchmarks", "Benchmarks", <IconChart size={15} />)}
          </>
        )}
      </div>
      <div className="nav-section">
        <button
          className="nav-section-title"
          onClick={() => toggleSection("automation")}
          aria-expanded={!collapsed.automation}
        >
          <span className={`nav-caret ${collapsed.automation ? "closed" : ""}`} aria-hidden="true">
            ▾
          </span>
          Automation
        </button>
        {!collapsed.automation && (
          <>
            {navBtn("agents", "Agents", <IconAgent size={15} />)}
            {navBtn("skills", "Skills", <IconBook size={15} />)}
            {navBtn("knowledge", "Knowledge", <IconBook size={15} />)}
            {navBtn("tools", "Tools", <IconWrench size={15} />)}
            {navBtn("workflows", "Workflows", <IconFlow size={15} />)}
            {navBtn("schedules", "Schedules", <IconClock size={15} />)}
            {navBtn("mcp", "MCP Servers", <IconPlug size={15} />)}
            {/* The browser docks beside the conversation rather than taking
                over the window — you can watch the model use it while you talk. */}
            <button
              className={`nav-btn ${browserDock ? "active" : ""}`}
              onClick={() => {
                if (view !== "chat" && view !== "voice") setView("chat");
                setBrowserDock(!browserDock);
              }}
            >
              <span className="nav-icon">
                <IconCompass size={15} />
              </span>
              Browser
            </button>
          </>
        )}
      </div>
      <div className="nav-section">
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
                  x
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
