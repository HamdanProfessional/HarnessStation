/**
 * Swarm — coordination between agents working at the same time.
 *
 * Two agents in one folder step on each other silently: A edits a file B already
 * read, and B keeps reasoning about a version that no longer exists. So we track
 * which files each running session has read, and when someone writes to one of
 * them the other sessions get told — the code shifted under their feet, and they
 * can re-read it or decide it doesn't matter.
 *
 * On top of that, sessions can message each other, which is what makes a
 * coordinator-and-workers split actually work instead of just being parallel
 * strangers.
 */

export interface SwarmMessage {
  from: string;
  kind: "message" | "file-changed";
  text: string;
  ts: number;
}

interface Session {
  id: string;
  name: string;
  cwd: string;
  /** Files this session has read, normalised. */
  read: Set<string>;
  inbox: SwarmMessage[];
  startedAt: number;
}

const sessions = new Map<string, Session>();
let seq = 0;

function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Register a running agent. Returns the session id used by every other call. */
export function joinSwarm(name: string, cwd = ""): string {
  const id = `s${++seq}`;
  sessions.set(id, { id, name, cwd, read: new Set(), inbox: [], startedAt: Date.now() });
  return id;
}

export function leaveSwarm(id: string): void {
  sessions.delete(id);
}

export function listSessions(): { id: string; name: string; cwd: string }[] {
  return [...sessions.values()].map(({ id, name, cwd }) => ({ id, name, cwd }));
}

/** Record that a session has read a file, so it can be told if it changes. */
export function noteRead(id: string, path: string): void {
  const s = sessions.get(id);
  if (s && path) s.read.add(norm(path));
}

/**
 * Record a write. Every *other* session that had read this file gets a notice.
 * The writer isn't told about its own edit.
 */
export function noteWrite(id: string, path: string): void {
  if (!path) return;
  const key = norm(path);
  const writer = sessions.get(id);
  for (const s of sessions.values()) {
    if (s.id === id || !s.read.has(key)) continue;
    s.inbox.push({
      from: writer?.name ?? "another agent",
      kind: "file-changed",
      text: `${path} was just modified by ${writer?.name ?? "another agent"} after you read it. Re-read it before relying on what you saw, or confirm your change still applies.`,
      ts: Date.now(),
    });
  }
  // A write is also a read for conflict purposes — the writer now depends on it.
  writer?.read.add(key);
}

/** Send a message to one session by name/id, or to everyone else with "*". */
export function sendMessage(from: string, to: string, text: string): string {
  const sender = sessions.get(from);
  const fromName = sender?.name ?? "agent";
  const targets =
    to === "*" || to.toLowerCase() === "all"
      ? [...sessions.values()].filter((s) => s.id !== from)
      : [...sessions.values()].filter(
          (s) => s.id !== from && (s.id === to || s.name.toLowerCase() === to.toLowerCase()),
        );
  if (!targets.length) return `No other agent matches "${to}". Currently running: ${describe(from)}`;
  for (const t of targets) t.inbox.push({ from: fromName, kind: "message", text, ts: Date.now() });
  return `Sent to ${targets.map((t) => t.name).join(", ")}.`;
}

/** Drain this session's inbox and format it for the model. "" when empty. */
export function takeInbox(id: string): string {
  const s = sessions.get(id);
  if (!s || !s.inbox.length) return "";
  const items = s.inbox.splice(0);
  return items
    .map((m) => (m.kind === "file-changed" ? `[swarm] ${m.text}` : `[swarm] ${m.from}: ${m.text}`))
    .join("\n");
}

/** One-line summary of who else is running, for tool output. */
export function describe(exclude = ""): string {
  const others = [...sessions.values()].filter((s) => s.id !== exclude);
  if (!others.length) return "no other agents are running.";
  return others.map((s) => `${s.name} (${s.id})`).join(", ");
}

/** File tools whose path argument means "this session now depends on this file". */
const READ_TOOLS = new Set(["read_file", "grep_files", "list_folder", "find_files"]);
const WRITE_TOOLS = new Set(["write_file", "edit_file", "delete_path", "create_folder"]);

/** Hook a tool call into the swarm's file tracking. Safe to call for any tool. */
export function trackToolFile(
  sessionId: string | undefined,
  toolId: string,
  args: Record<string, unknown>,
): void {
  if (!sessionId) return;
  const path = String(args.path ?? args.file ?? args.filename ?? args.dir ?? "");
  if (!path) return;
  if (READ_TOOLS.has(toolId)) noteRead(sessionId, path);
  else if (WRITE_TOOLS.has(toolId)) noteWrite(sessionId, path);
}
