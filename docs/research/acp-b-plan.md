# Option B build plan & contract — 25 Aug 2026

Implements `acp-decision-2026-08-25.md` Option B: any ACP-registry agent hosts
inside HarnessStation's chat. Four work packages; this file is the contract
that lets them be built in parallel. **If an implementation must deviate from a
name or shape here, update this file in the same change** — it is the source
of truth the other packages read.

## The protocol being bridged

ACP v1: newline-delimited JSON-RPC 2.0 over the child's stdio. Methods the
client sends: `initialize`, `session/new`, `session/prompt`, `session/cancel`,
optionally `session/load`/`resume`/`close`. Methods the agent may send:
notifications `session/update` (params `{sessionId, update:{sessionUpdate,
...}}` — kinds include `agent_message_chunk`, `tool_call`, `tool_call_update`,
`plan`), requests `session/request_permission` (params include `options:
[{optionId, name, kind}]`; the client responds `result: {outcome: {outcome:
"selected", optionId}}` or `{outcome: {outcome: "cancelled"}}`), and
`fs/*`/`terminal/*` (out of scope for v1 of this feature — respond with a
JSON-RPC error). Full docs: agentclientprotocol.com/protocol/v1/*.

## WP1 — Rust relay (`src-tauri/src/acp.rs`, module `acp`)

Mirror `claudecode.rs` for process handling and keep Rust a dumb pipe, the
way `localapi.rs` is a dumb pipe for HTTP: Rust never parses ACP semantics.

Managed state: `pub struct AcpState(pub Mutex<HashMap<String, AcpChild>>)` —
`AcpChild { child: Child, stdin: ChildStdin }`. Registered in `lib.rs`
`.manage(AcpState::default())` and in `generate_handler!`.

Commands (exact names/signatures):

| Command | Signature | Behaviour |
| --- | --- | --- |
| `acp_spawn` | `(app: AppHandle, state, id: String, command: String, args: Vec<String>, env: HashMap<String,String>) -> Result<(), String>` | Spawn with piped stdio/stdout, `CREATE_NO_WINDOW` on Windows (see claudecode.rs), env merged over inherited. Spawn a reader thread: every stdout line → `app.emit("acp-event", json!({"id": id, "line": line}))`. On child exit → `app.emit("acp-exit", json!({"id": id}))` and remove from the map. Spawning an id that is already live: kill the old child first (replace). |
| `acp_write` | `(state, id: String, line: String) -> Result<(), String>` | Write `line + "\n"` to the child's stdin, flush. Error "no such agent" when absent. |
| `acp_kill` | `(state, id: String) -> Result<(), String>` | Kill child, remove from map. Ok when absent. |
| `acp_running` | `(state, id: String) -> bool` | True when a live child exists. |

Events: `acp-event` `{ id: String, line: String }` (one per stdout line, raw —
the frontend owns JSON parsing and correlation), `acp-exit` `{ id: String }`.
stderr: drained and ignored (or logged) — never forwarded on stdout.

Tests: unit-test what is pure; the relay itself is covered end-to-end by WP3's
fake-agent tests on the TS side. `cargo test --lib` must stay green and
`cargo clippy --lib` must not gain new warnings.

## WP2 — settings & types

`src/lib/types.ts`:

```ts
export interface AcpAgentConfig {
  id: string;        // stable, used as the relay key and event id
  name: string;      // display name
  command: string;   // e.g. "node" or an absolute path
  args?: string[];   // e.g. ["…/acp.mjs", "--model", "sonnet"]
  env?: Record<string, string>;
}
```

`Settings.acpAgents?: AcpAgentConfig[]`. Settings ride bundles wholesale — no
storage.ts changes. UI: a "Subscriptions"-style card section in
SettingsView (new tab `acp`, section `core`, after "subscriptions") — add /
edit / remove rows mirroring the Combos tab patterns (draft + mergeEdits
already handles new keys). Desktop-only feature; the section should say so via
`isWeb()` like SubscriptionsPanel does.

## WP3 — TS client (`src/lib/acp.ts`)

```ts
export interface AcpBridge {
  spawn(id: string, command: string, args: string[], env: Record<string, string>): Promise<void>;
  write(id: string, line: string): Promise<void>;
  kill(id: string): Promise<void>;
  onEvent(cb: (id: string, line: string) => void): Promise<() => void>; // unlisten
  onExit(cb: (id: string) => void): Promise<() => void>;
}
```

Default bridge = tauri invoke/listen wiring for the WP1 contract. The factory
takes an optional bridge so tests inject a fake:

```ts
export interface AcpHooks {
  onUpdate(update: AcpUpdate): void;               // parsed params.update
  onRequestPermission(req: AcpPermissionRequest): Promise<string | null>; // optionId | null(=cancelled)
  onExit?(error?: string): void;
}
export function acpConnect(
  cfg: AcpAgentConfig,
  hooks: AcpHooks,
  bridge: AcpBridge = tauriBridge,
): Promise<AcpSession>;
// AcpSession: { sessionId: string; prompt(text: string): Promise<{ stopReason: string }>;
//               cancel(): void; dispose(): Promise<void> }
```

Behaviour: spawn → `initialize` (protocolVersion 1, clientCapabilities `{}`,
clientInfo `{name:"harnessstation"}`) → `session/new` (cwd: the app has no
session cwd concept — send the agent none? The spec REQUIRES cwd; send the
OS home via `os.homedir()`-equivalent already available? Use `platform.ts`'s
home if exposed, else `"/"` fallback and document) → ready. `prompt` appends
text, writes `session/prompt`, correlates the response by id, routes
`session/update` notifications to `onUpdate`, answers
`session/request_permission` by calling `onRequestPermission` (which the UI
backs with the askUser dialog) and writing the selected outcome; `null` maps
to the `cancelled` outcome. `cancel` writes `session/cancel`. `dispose`
kills the child. Unknown agent→client methods (`fs/*`, `terminal/*`) get
JSON-RPC errors. Agent exit mid-prompt rejects pending prompts with a clear
error and fires `onExit`.

Tests (`tests/acpClient.test.ts` + `tests/fake-acp-agent.mjs`): a real
subprocess fake agent (node) driven through `acpConnect` with an injected
bridge that spawns it — covers initialize/new/prompt streaming/permission
round-trip/cancel/dispose. Node is available in the vitest environment.

## WP4 — UI (`src/components/AcpView.tsx` + registration)

New view id `"acp"`, label "ACP agents", section `"automation"` in
`lib/views.tsx` (icon: reuse an existing one), added to `ESSENTIALS_HIDDEN`
in `storage.ts`. The view, modeled on `ClaudeCodeView` but simpler:

- List configured `settings.acpAgents` with Connect/Disconnect (spawn/kill)
  and running state (`acp_running` polled or tracked via acp-exit).
- A transcript (user prompts, agent chunks as markdown, tool_call updates as
  compact status lines), a prompt textarea (Enter sends), Stop button
  (cancel), New session.
- Permission requests surface through `lib/askUser` with the agent's option
  labels; `null`/dismiss = cancelled outcome.
- Desktop-only guard like SubscriptionsPanel.

## Out of scope (this build)

`session/load`/`resume`/`list`, fs/terminal client methods, registry
install-from-Discover, ACP v2.
