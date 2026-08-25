# `hs` — HarnessStation from the command line

Ships inside the desktop app (`bundle.resources` puts it at `<install>/cli/`)
so an agent, a script, or a person in a terminal can drive the same harness the
UI drives.

    node cli/hs.mjs status
    node cli/hs.mjs chat "summarise this repo"
    node cli/hs.mjs chat            # interactive multi-turn session
    node cli/hs.mjs endpoint        # base URL + paste-ready configs

In a checkout, `npm link` puts `hs` on PATH.

## Why it is a client, not a second implementation

HarnessStation's core — providers, streaming, tools — is TypeScript that imports
`@tauri-apps/plugin-http` and `@tauri-apps/plugin-fs`. Those only resolve inside
the app. Reimplementing them for Node would fork the provider layer, and the
fork would drift the first time a provider changed.

So the split is:

| Needs a model | Goes through the app's OpenAI-compatible server | app must be running |
| Just files    | Reads `~/.harnessx` directly                    | works with app closed |

`agents`, `skills` and `status` work offline. `chat` and `models` do not.

## The endpoint under your tools

The app's local server is not just for `hs` — it is a full OpenAI-compatible
endpoint (streaming, function calling on openai-compatible providers) and also
speaks the **Anthropic Messages protocol** at `/v1/messages`. That means the
tools you already use can drive the models configured here, local GGUFs
included:

- **opencode / Aider / any OpenAI SDK** — `hs endpoint` prints a paste-ready
  provider block.
- **Claude Code** — `hs endpoint` prints the environment:

  ```
  ANTHROPIC_BASE_URL=http://127.0.0.1:11435
  ANTHROPIC_AUTH_TOKEN=hs-local
  ANTHROPIC_MODEL=groq/llama-3.3-70b     # or an agent slug
  ```

  Model ids take the same forms as everywhere else: `provider/model`,
  `agent/<slug>`, `combo/<slug>` — an unknown bare name (Claude Code sends its
  own) falls back to the default provider's first model.

## `hs-acp` — an Agent Client Protocol agent

`acp.mjs` speaks ACP v1, so HarnessStation's models, agents and combos appear
in the agent picker of any ACP client — JetBrains 2026.2+, Zed, Devin Desktop.
ACP launches it as a subprocess; it forwards prompts to the local API and
streams replies back. Model-only by design: the editor's own MCP servers are
where tools come from.

```jsonc
// JetBrains: ~/.jetbrains/acp.json  (or the ACP agent panel → add)
{
  "harnessstation": {
    "command": "node",
    "args": ["<install>/cli/acp.mjs", "--model", "combo/cheap-first"]
  }
}

// Zed: settings.json
{
  "agent": { "custom_servers": { "harnessstation": { "command": …, "args": […] } } }
}
```

Pick the model at launch: `--model <id>`, `--agent <name>` (sugar for
`agent/<name>`), `--system <text>`; with none, the API's first model is used.
`--port` overrides settings, like `hs`. Sessions are per-connection and
in-memory; cancellation maps to aborting the stream. Registering in the
[ACP registry](https://agentclientprotocol.com/get-started/registry) is a PR
adding this command to `agentclientprotocol/registry`.

## Interactive sessions

`hs chat` with no prompt opens a multi-turn session: replies stream as they
arrive, the transcript rides along in memory, and slash commands manage it —
`/new`, `/model [id]`, `/agent [name]`, `/system <text>`, `/history`, `/exit`.
Ctrl+C stops a running reply; Ctrl+D leaves.

## Requirements

**Node 18+.** The desktop app does not bundle a Node runtime, so on a machine
without one the CLI will not run even though the files are installed. That is
fine for its two intended audiences — agents and development — and would need a
compiled binary to change.

## Turning the server on

`chat` and `models` need the app's local API server, which is off by default:
Settings → Local API. `hs doctor` says which of the three possible causes is
stopping you, and exits non-zero, so it can gate a script.

## Notes

- Exit codes: `0` success, `1` real failure, `2` misuse. A wrapper that always
  exits 0 cannot be used in a pipeline.
- `--port` overrides settings *and* the enabled check — naming a port says where
  to go, so the app's own toggle no longer governs it. That is what lets you
  point `hs` at any OpenAI-compatible server.
- `--json` on `status`, `models`, `agents`, `skills` for machine consumption.
