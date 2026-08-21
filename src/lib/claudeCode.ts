import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * The Claude Code side of the wrapper: the part that understands the protocol.
 *
 * `src-tauri/src/claudecode.rs` spawns the CLI and forwards its stdout lines
 * verbatim without parsing them. This file is the only place that knows what an
 * event *means*, which keeps the vocabulary — which moves on Claude Code's
 * release schedule, not ours — out of Rust and out of a rebuild.
 *
 * Shapes below were read off a live `claude -p --output-format stream-json`
 * run (CLI 2.1.239), not from memory.
 */

/** Everything the CLI emits carries a type; the ones we act on are named. */
export type ClaudeEvent =
  | SystemInit
  | { type: "system"; subtype: "thinking_tokens"; estimated_tokens: number }
  | { type: "system"; subtype: string; [k: string]: unknown }
  | { type: "assistant"; message: ApiMessage; parent_tool_use_id: string | null }
  | { type: "user"; message: ApiMessage; parent_tool_use_id: string | null }
  | { type: "rate_limit_event"; rate_limit_info: unknown }
  | ClaudeResult
  | { type: string; [k: string]: unknown };

/**
 * The first event of every run, and the reason this wrapper can be trusted.
 *
 * It reports what the session actually loaded — agents, skills, tools, plugins
 * — so injection can be *verified* rather than assumed. If a `--plugin-dir`
 * path is wrong the CLI does not fail; the skill is simply absent from here.
 */
export interface SystemInit {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  cwd: string;
  permissionMode: string;
  apiKeySource: string;
  output_style: string;
  tools: string[];
  agents: string[];
  skills: string[];
  slash_commands: string[];
  mcp_servers: unknown[];
  plugins: { name: string; path: string; source: string; version: string }[];
}

export interface ClaudeResult {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_during_execution" | string;
  is_error: boolean;
  result: string;
  session_id: string;
  num_turns: number;
  duration_ms: number;
  total_cost_usd: number;
  stop_reason: string | null;
  usage: Record<string, unknown>;
}

/** A Messages-API shaped message; content blocks are the API's own. */
export interface ApiMessage {
  role: "assistant" | "user";
  content: ContentBlock[] | string;
  model?: string;
  stop_reason?: string | null;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export interface LaunchSpec {
  cwd?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | "";
  permissionMode?: "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan" | "";
  /** Custom agents, stringified as the `--agents` object. Build with `agentsArg`. */
  agentsJson?: string;
  /** Directories holding an injected plugin — this is how skills get in. */
  pluginDirs?: string[];
  mcpConfigs?: string[];
  appendSystemPrompt?: string;
  tools?: string[];
  /**
   * Which of the user's own settings files to load. `""` means none.
   *
   * Left undefined this inherits the developer's whole environment — their
   * skills, agents, output style and MCP servers — so the same HarnessStation
   * run behaves differently on every machine. See ISOLATED.
   */
  settingSources?: string;
  /** Disable every customization, including ours (`--safe-mode`). */
  safeMode?: boolean;
  maxBudgetUsd?: number;
  resume?: string;
  partialMessages?: boolean;
  forwardSubagentText?: boolean;
}

/**
 * The isolation baseline: stop reading the user's settings files.
 *
 * A probe run without this came back carrying the host user's own agents, their
 * output style and their Discord MCP tools — none of which HarnessStation asked
 * for or can see. Since the app injects its own agents and skills, inheriting a
 * second set means a session that behaves differently per machine for invisible
 * reasons.
 *
 * It is not total, and the difference is worth knowing before relying on it. A
 * live run with `settingSources: ""` did reset the output style to default and
 * drop the user-defined agents — but Claude Code's *built-in* agents (Explore,
 * Plan, general-purpose) and its bundled skills still loaded, because those do
 * not come from settings files. `safeMode: true` is the flag that removes those
 * too; it also removes our injections, so it inspects rather than isolates.
 */
export const ISOLATED = { settingSources: "" } as const;

export interface ClaudeCodeEvent {
  runId: number;
  /** A raw JSON line from the CLI, or null for a relay notice. */
  line: string | null;
  /** Relay-level message — stderr, or a spawn failure. Not protocol. */
  notice: string | null;
  done: boolean;
}

let seq = 0;
/** Run ids are ours, not the CLI's: they tell a replaced run's late events apart. */
export const nextRunId = () => ++seq;

export const claudeProbe = () => invoke<string | null>("claude_probe");
export const claudeStatus = () => invoke<{ running: boolean; run_id: number | null }>("claude_status");
export const claudeStart = (spec: LaunchSpec, runId: number) =>
  invoke("claude_start", { spec, runId });
export const claudeSend = (text: string) => invoke("claude_send", { text });
export const claudeEndInput = () => invoke("claude_end_input");
export const claudeStop = () => invoke("claude_stop");

/**
 * Subscribe to a run's events, parsed.
 *
 * A malformed line is handed to `onNotice` rather than thrown: the CLI writes
 * the occasional non-JSON warning to stdout (a slow-stdin notice, for one), and
 * killing the stream over it would lose the rest of a working session.
 */
export function onClaudeEvent(
  runId: number,
  handlers: {
    onEvent: (e: ClaudeEvent) => void;
    onNotice?: (text: string) => void;
    onDone?: () => void;
  },
): Promise<UnlistenFn> {
  return listen<ClaudeCodeEvent>("claude-code-event", ({ payload }) => {
    // A stale run's events must not land in the current transcript.
    if (payload.runId !== runId) return;
    if (payload.notice) handlers.onNotice?.(payload.notice);
    if (payload.done) handlers.onDone?.();
    if (!payload.line) return;
    try {
      handlers.onEvent(JSON.parse(payload.line) as ClaudeEvent);
    } catch {
      handlers.onNotice?.(payload.line);
    }
  });
}

// ---------- reading the stream ----------

export const isInit = (e: ClaudeEvent): e is SystemInit =>
  e.type === "system" && (e as SystemInit).subtype === "init";

export const isResult = (e: ClaudeEvent): e is ClaudeResult => e.type === "result";

/** Concatenated text of an assistant message, ignoring thinking and tool blocks. */
export function assistantText(e: ClaudeEvent): string {
  if (e.type !== "assistant") return "";
  const content = (e as { message: ApiMessage }).message?.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Tool calls in an assistant message, for showing what it is doing. */
export function toolUses(e: ClaudeEvent): { id: string; name: string; input: unknown }[] {
  if (e.type !== "assistant") return [];
  const content = (e as { message: ApiMessage }).message?.content;
  if (typeof content === "string" || !content) return [];
  return content.filter(
    (b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use",
  );
}

/**
 * Whether an assistant event came from a subagent rather than the main loop.
 *
 * Only populated when the run passes `--forward-subagent-text`; without it
 * subagent output never surfaces as messages at all.
 */
export const isSubagent = (e: ClaudeEvent): boolean =>
  (e.type === "assistant" || e.type === "user") &&
  !!(e as { parent_tool_use_id: string | null }).parent_tool_use_id;
