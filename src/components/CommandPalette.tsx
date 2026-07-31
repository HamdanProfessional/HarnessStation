import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type View } from "../lib/store";

interface Cmd {
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setSel(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Cmd[]>(() => {
    const nav = (v: View, label: string): Cmd => ({
      label,
      hint: "Go to",
      run: () => store.setView(v),
    });
    const list: Cmd[] = [
      { label: "New chat", hint: "Action", run: () => store.newChat() },
      nav("chat", "Chat"),
      nav("compare", "Compare models"),
      nav("discover", "Discover"),
      nav("models", "My Models"),
      nav("benchmarks", "Benchmarks"),
      nav("knowledge", "Knowledge"),
      nav("agents", "Agents"),
      nav("tools", "Tools"),
      nav("workflows", "Workflows"),
      nav("schedules", "Schedules"),
      nav("mcp", "MCP Servers"),
      nav("settings", "Settings"),
    ];
    for (const a of store.agents) {
      list.push({ label: a.name, hint: "Apply agent", run: () => store.applyAgentToChat(a.id) });
    }
    for (const c of store.chats.slice(0, 40)) {
      list.push({ label: c.title, hint: "Open chat", run: () => store.selectChat(c.id) });
    }
    return list;
  }, [store]);

  const q = query.toLowerCase();
  const filtered = q
    ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q))
    : commands;

  if (!open) return null;

  const choose = (c?: Cmd) => {
    if (c) c.run();
    setOpen(false);
  };

  return createPortal(
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="cmdk-input"
          placeholder="Type a command or search... (Esc to close)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(filtered[sel]);
            }
          }}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="hint" style={{ padding: 12 }}>No matches.</div>}
          {filtered.slice(0, 60).map((c, i) => (
            <button
              key={i}
              className={`cmdk-item ${i === sel ? "active" : ""}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(c)}
            >
              <span>{c.label}</span>
              {c.hint && <span className="cmdk-hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
