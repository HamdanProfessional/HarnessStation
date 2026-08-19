import { useEffect, useState } from "react";
import type { Chat, Message, MessageTrace } from "../lib/types";
import { prettyName } from "../lib/format";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";
import { IconX } from "./icons";

/**
 * A read-only, step-by-step trace of a run. Everything the model actually saw
 * and did — system prompt, retrieved context, thinking, each tool call + its
 * result, with per-step timing — laid out as a timeline. Opposite of hiding the
 * process: you can open any step and read the raw payload.
 */

function fmtDur(ms?: number): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function fmtTime(ts?: number): string | null {
  if (ts == null) return null;
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return null;
  }
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** A collapsible block of monospace payload text. */
function Payload({ label, text, open: initOpen = false }: { label: string; text: string; open?: boolean }) {
  const [open, setOpen] = useState(initOpen);
  if (!text) return null;
  return (
    <div className="traj-payload">
      <button className="traj-payload-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="traj-payload-toggle">{open ? "▾" : "▸"}</span>
        {label}
        <span className="traj-payload-size">{text.length.toLocaleString()} chars</span>
      </button>
      {open && <pre className="traj-payload-body">{text}</pre>}
    </div>
  );
}

function ContextBlock({ trace }: { trace: MessageTrace }) {
  const rows: [string, string | undefined][] = [
    ["System prompt", trace.system],
    ["Knowledge (RAG)", trace.rag],
    ["Memory", trace.memory],
    ["Skills index", trace.skills],
    ["Project brief", trace.project],
    ["AGENTS.md", trace.agentsMd],
  ];
  const present = rows.filter(([, v]) => v && v.trim());
  if (!present.length) return null;
  return (
    <div className="traj-context">
      <div className="traj-context-title">Context fed to the model</div>
      {present.map(([label, v]) => (
        <Payload key={label} label={label} text={v as string} />
      ))}
    </div>
  );
}

function StepNode({ m }: { m: Message }) {
  const dur = fmtDur(m.durationMs);
  const time = fmtTime(m.startedAt);
  const tok = (m.promptTokens ?? 0) + (m.completionTokens ?? 0);

  if (m.role === "user") {
    return (
      <div className="traj-step traj-user">
        <span className="traj-dot" />
        <div className="traj-body">
          <div className="traj-step-head">
            <span className="traj-kind">User</span>
          </div>
          <div className="traj-text">{m.content || <em className="traj-empty">(empty)</em>}</div>
        </div>
      </div>
    );
  }

  if (m.role === "tool") {
    return (
      <div className="traj-step traj-tool">
        <span className="traj-dot" />
        <div className="traj-body">
          <div className="traj-step-head">
            <span className="traj-kind">Tool result</span>
            {m.toolName && <b className="traj-tool-name">{prettyName(m.toolName)}</b>}
            {dur && <span className="traj-meta">{dur}</span>}
          </div>
          {m.attachments?.length ? (
            <div className="traj-text traj-empty">
              {m.attachments.map((a) => `[${a.kind}: ${a.name}]`).join(" ")}
            </div>
          ) : (
            <Payload label="Result" text={m.content} />
          )}
        </div>
      </div>
    );
  }

  // assistant
  const hasText = m.content.trim().length > 0;
  return (
    <div className="traj-step traj-assistant">
      <span className="traj-dot" />
      <div className="traj-body">
        <div className="traj-step-head">
          <span className="traj-kind">Assistant</span>
          {m.round != null && <span className="traj-round">round {m.round}</span>}
          {dur && <span className="traj-meta">{dur}</span>}
          {tok > 0 && (
            <span className="traj-meta">
              {tok} tok{m.promptTokens != null ? ` (${m.promptTokens}→${m.completionTokens ?? 0})` : ""}
            </span>
          )}
          {time && <span className="traj-meta traj-time">{time}</span>}
        </div>
        {m.trace && <ContextBlock trace={m.trace} />}
        {m.reasoning && m.reasoning.trim() && <Payload label="Thinking" text={m.reasoning} />}
        {hasText && <div className="traj-text">{m.content}</div>}
        {m.toolCalls?.map((c) => (
          <div key={c.id} className="traj-toolcall">
            <span className="traj-arrow">→ calls</span> <b>{prettyName(c.name)}</b>
            <Payload label="Arguments" text={prettyJson(c.arguments)} />
          </div>
        ))}
        {!hasText && !m.toolCalls?.length && !m.reasoning && (
          <div className="traj-text traj-empty">(no output)</div>
        )}
      </div>
    </div>
  );
}

export function TrajectoryView({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const exportChat = useStore((s) => s.exportChat);
  const exportLog = async () => {
    try {
      const rel = await exportChat(chat.id, "jsonl");
      toast.success(`Session log → ~\\.harnessx\\${rel.replace("/", "\\")}`);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message || String(e)}`);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const model = chat.model;
  const steps = chat.messages.filter((m) => m.content || m.toolCalls?.length || m.reasoning || m.attachments?.length);

  // Aggregate stats
  const totalTok = chat.messages.reduce((n, m) => n + (m.promptTokens ?? 0) + (m.completionTokens ?? 0), 0);
  const assistantSteps = chat.messages.filter((m) => m.role === "assistant" && m.durationMs != null);
  const toolSteps = chat.messages.filter((m) => m.role === "tool" && m.durationMs != null);
  const totalMs = [...assistantSteps, ...toolSteps].reduce((n, m) => n + (m.durationMs ?? 0), 0);
  const hasTiming = totalMs > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="traj-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Trajectory">
        <div className="traj-header">
          <div>
            <h3>Trajectory</h3>
            <div className="traj-sub">{chat.title || "Untitled chat"}</div>
          </div>
          <div className="traj-stats">
            <span>{steps.length} steps</span>
            {totalTok > 0 && <span>{totalTok.toLocaleString()} tok</span>}
            {hasTiming && <span>{fmtDur(totalMs)} model+tools</span>}
            <span className="traj-model">{model}</span>
          </div>
          <button className="btn small" onClick={() => void exportLog()} title="Export session log (JSONL)">
            Export log
          </button>
          <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            <IconX size={12} />
          </button>
        </div>
        <div className="traj-scroll">
          {steps.length === 0 ? (
            <div className="traj-empty-all">Nothing to trace yet — send a message first.</div>
          ) : (
            <div className="traj-timeline">
              {steps.map((m, i) => (
                <StepNode key={i} m={m} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
