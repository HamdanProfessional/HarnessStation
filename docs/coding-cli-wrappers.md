# Wrapping Claude Code and opencode

Both are driven as child processes with their agents and skills injected from
HarnessStation. Everything below was verified against the installed binaries —
Claude Code **2.1.239**, opencode **1.18.19** — on 2026-08-22, not taken from
documentation. Where the published docs and the binaries disagree, that is
called out.

## The two protocols are not alike

|  | Claude Code | opencode |
|---|---|---|
| Shape | one long-lived process | one process per turn |
| Transport | newline JSON both ways over stdin/stdout | newline JSON on stdout only |
| Invocation | `-p --input-format stream-json --output-format stream-json --verbose` | `run --format json` |
| Continuity | the process holds it | `--session <id>`, read off the events |
| Turn input | a message envelope written to stdin | a positional argument |

`--verbose` is not optional for Claude Code. Without it the CLI collapses to a
single result line and every intermediate event is dropped, including
`system/init`.

### Event vocabularies

Claude Code: `rate_limit_event`, `system/init`, `system/thinking_tokens`,
`assistant`, `user`, `result`. The `result` event carries `total_cost_usd`,
`usage`, `num_turns` and `stop_reason`.

opencode: `step_start`, `text`, `step_finish`, `error` — four types, each with a
top-level `sessionID`. `step_finish` carries `cost` and a `tokens` breakdown
including cache read/write. Errors arrive as a normal event with exit code 1,
not on stderr; `error.name` discriminates `ProviderAuthError` (their
credentials) from `APIError` (endpoint unreachable), which need opposite
actions from the user.

## Injection

**Claude Code** takes agents as one `--agents` JSON object. Skills have no flag,
so they go in as a generated plugin directory passed to `--plugin-dir`, laid out
as `.claude-plugin/plugin.json` plus `skills/<name>/SKILL.md`. A missing
manifest means the directory is ignored silently.

**opencode** has no `--agents` flag. Instead `OPENCODE_CONFIG_DIR` points at a
whole config directory — `agent/<name>.md` and `skills/<name>/SKILL.md` — which
is better for our purposes because it lives outside the user's project and we
never write into their repo.

Two findings that are not in the published docs:

- opencode reads **Claude Code's skill format verbatim**, from
  `.claude/skills/<name>/SKILL.md` as well as its own paths. So `claudeSkillFile`
  is shared between both kits; only the surrounding layout differs.
- opencode's docs give the agent directory as `agents/` (plural). Both `agent/`
  and `agents/` are read — confirmed by loading one of each and listing them.

## Verifying that injection worked

Neither CLI fails loudly when injection doesn't take. A `--plugin-dir` that
doesn't resolve is ignored, and the skill is simply absent.

Claude Code reports what it loaded in `system/init` — agents, skills, tools,
plugins — so the view displays that rather than asserting success. opencode has
no equivalent event on the `run` path; it can only be checked out of band with
`opencode debug skill` and `opencode agent list`.

## Isolation

Claude Code inherits the host user's environment by default. A probe run picked
up their agents, output style and MCP tools — none of which this app asked for
or can see, so the same session behaves differently on every machine.

`--setting-sources ""` is the default here, and it is **partial**: it reset the
output style and dropped user-defined agents, but Claude Code's built-in agents
(Explore, Plan, general-purpose) and bundled skills still loaded, because those
do not come from settings files. `--safe-mode` removes those too — and also
removes our injections, so it inspects rather than isolates.

opencode has **no equivalent switch**. `--pure` sounds like one but only skips
external plugins; a live run confirmed skills and agents still load under it. So
on opencode our agents and skills are added alongside the user's, not
substituted for them, and the UI says so.

## Auth

Claude Code reported `apiKeySource: none` and authenticated from the existing
OAuth profile — a user with a Claude subscription needs no API key.

opencode resolves models as `provider/model` and fails fast with
`ProviderAuthError` when the provider is not signed in. Note it lists
`GEMINI_API_KEY` as a credential while the underlying SDK reads
`GOOGLE_GENERATIVE_AI_API_KEY`, so a Google key can appear configured and still
fail at dispatch.
