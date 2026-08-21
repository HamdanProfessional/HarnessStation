# `hs` — HarnessStation from the command line

Ships inside the desktop app (`bundle.resources` puts it at `<install>/cli/`)
so an agent, a script, or a person in a terminal can drive the same harness the
UI drives.

    node cli/hs.mjs status
    node cli/hs.mjs chat "summarise this repo"

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
