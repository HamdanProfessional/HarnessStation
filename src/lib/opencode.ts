import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * The opencode side of the CLI wrappers: the part that understands its events.
 *
 * Mirrors `claudeCode.ts`, but the protocols are not alike. Claude Code streams
 * a long-lived session over stdin/stdout; opencode's `run` is one process per
 * turn, and turns chain by passing the `sessionID` from the previous run's
 * events back in. So continuity lives here, in `session`, rather than in a
 * process.
 *
 * Every shape below was read off a live `opencode run --format json`
 * (opencode 1.18.19), not from memory. The vocabulary is small — four types.
 */

export type OpencodeEvent =
  | { type: "step_start"; sessionID: string; timestamp: number; part: Part }
  | { type: "text"; sessionID: string; timestamp: number; part: TextPart }
  | { type: "step_finish"; sessionID: string; timestamp: number; part: StepFinishPart }
  | { type: "error"; sessionID: string; timestamp: number; error: OpencodeError }
  | { type: string; sessionID?: string; timestamp?: number; [k: string]: unknown };

export interface Part {
  id: string;
  messageID: string;
  sessionID: string;
  type: string;
}

export interface TextPart extends Part {
  text: string;
  time?: { start: number; end?: number };
}

export interface StepFinishPart extends Part {
  reason: string;
  cost: number;
  tokens: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { write: number; read: number };
  };
}

/**
 * Errors arrive as a normal event with exit code 1, not on stderr.
 *
 * `name` is the discriminator worth reading: `ProviderAuthError` means their
 * credentials, `APIError` means the endpoint was unreachable — two very
 * different things to tell the user, and both look identical if you only show
 * `data.message`.
 */
export interface OpencodeError {
  name: string;
  data?: { message?: string; providerID?: string; [k: string]: unknown };
}

export interface RunSpec {
  message: string;
  cwd?: string;
  /** `provider/model`. Empty uses whatever they configured as default. */
  model?: string;
  agent?: string;
  /** Provider-specific reasoning effort: high, max, minimal… */
  variant?: string;
  /** Carry this from the previous turn's events to continue the conversation. */
  session?: string;
  fork?: boolean;
  /** Auto-approve permissions. opencode's own help calls this dangerous. */
  auto?: boolean;
  /** Skip external plugins. Note this does NOT drop skills or agents. */
  pure?: boolean;
  files?: string[];
  /** Directory to inject agents and skills from, via OPENCODE_CONFIG_DIR. */
  configDir?: string;
}

export interface OpencodeRelayEvent {
  runId: number;
  line: string | null;
  notice: string | null;
  done: boolean;
}

let seq = 0;
export const nextRunId = () => ++seq;

export const opencodeProbe = () => invoke<string | null>("opencode_probe");
export const opencodeRun = (spec: RunSpec, runId: number) => invoke("opencode_run", { spec, runId });
export const opencodeStop = () => invoke("opencode_stop");

export function onOpencodeEvent(
  runId: number,
  handlers: {
    onEvent: (e: OpencodeEvent) => void;
    onNotice?: (text: string) => void;
    onDone?: () => void;
  },
): Promise<UnlistenFn> {
  return listen<OpencodeRelayEvent>("opencode-event", ({ payload }) => {
    if (payload.runId !== runId) return;
    if (payload.notice) handlers.onNotice?.(payload.notice);
    if (payload.done) handlers.onDone?.();
    if (!payload.line) return;
    try {
      handlers.onEvent(JSON.parse(payload.line) as OpencodeEvent);
    } catch {
      handlers.onNotice?.(payload.line);
    }
  });
}

// ---------- reading the stream ----------

export const isOpencodeError = (
  e: OpencodeEvent,
): e is { type: "error"; sessionID: string; timestamp: number; error: OpencodeError } =>
  e.type === "error";

export const isStepFinish = (
  e: OpencodeEvent,
): e is { type: "step_finish"; sessionID: string; timestamp: number; part: StepFinishPart } =>
  e.type === "step_finish";

/** Assistant text from a `text` event. */
export function opencodeText(e: OpencodeEvent): string {
  if (e.type !== "text") return "";
  return (e as { part?: TextPart }).part?.text ?? "";
}

/**
 * A message worth showing for a failed run.
 *
 * Leads with the failure class rather than the raw message: "Cannot connect to
 * API" and "API key is missing" both read as generic breakage otherwise, and
 * they need opposite actions from the user.
 */
export function describeError(err: OpencodeError): string {
  const detail = err.data?.message?.trim();
  if (err.name === "ProviderAuthError") {
    const p = err.data?.providerID;
    return `Not signed in${p ? ` to ${p}` : ""} — run \`opencode providers\`. ${detail ?? ""}`.trim();
  }
  if (err.name === "APIError") {
    return `Could not reach the model. ${detail ?? ""}`.trim();
  }
  return detail ? `${err.name}: ${detail}` : err.name;
}
