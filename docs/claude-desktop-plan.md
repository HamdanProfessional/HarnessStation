# Claude Desktop: Feature Research & HarnessX Copy Plan

> Research date: 2026-07-18.
> Goal: copy Claude Desktop's *simple* features (system instructions and friends) into HarnessX.

## 1. How Claude Desktop's instruction features work

Claude Desktop layers several instruction-like features; each covers a different axis:

| Feature | Scope | What it is |
|---|---|---|
| **Profile Preferences** | Global (every chat) | Settings → Profile → "What preferences should Claude consider in responses?" One textarea, loaded before the first message of every conversation. Recommended under ~500 words. |
| **Project custom instructions** | Per-project | Persistent system-prompt text applying to all chats inside that project only. |
| **Project knowledge** | Per-project | Uploaded files retrieved RAG-style (excerpts pulled in per message, not concatenated whole). |
| **Styles** | Per-conversation | Tone/format layer. Presets: Normal, Concise, Explanatory, Formal, Learning. Custom styles can be trained on writing samples. Picked via a flyout next to the prompt input. |

Effective composition (not officially documented; inferred from support docs + community): **Profile Preferences → Project instructions → Style → retrieved knowledge → user message.** Preferences set global behavior; project instructions add domain context; styles control *how* it writes rather than *what* it knows.

## 2. Other notable features

- **MCP servers**: configured in `%APPDATA%\Claude\claude_desktop_config.json` with a top-level `mcpServers` object (`command`, `args`, optional `env` per server); Claude spawns each as a stdio subprocess. One malformed comma silently disables all servers — no validation UI. One-click **Desktop Extensions** (`.mcpb` zip with `manifest.json`, bundled runtime, keychain secrets) sit on top of this.
- **Artifacts**: side panel with live preview/edit for self-contained content (code, HTML, React, SVG).
- **Attachments**: drag-and-drop, 20 files / 30 MB each per chat.
- **Quick entry**: global hotkey (double-tap Option on Mac) opens a floating prompt window.
- **Chat history**: sidebar list with search.

## 3. Simple vs. complex to clone

**Simple** (copy in v1):
- Global system instructions textarea → prepend to every request.
- Per-chat system prompt override (extends or replaces global).
- Style presets: 3–4 hardcoded instruction snippets (Normal / Concise / Explanatory / Formal) in a dropdown, appended to the system prompt.
- Basic file attachment: inline a text/code file's contents into context.
- Chat history list with substring search (plain JSON on disk).

**Medium** (v2 candidates):
- MCP via a `mcp_config.json` identical in shape to Claude's `mcpServers` — read at startup, spawn stdio subprocesses, expose tools. No installer UI; manual JSON editing like early Claude Desktop. Add JSON validation with a clear error (fixing Claude's silent-failure flaw).
- Global hotkey + floating quick-entry window (Windows `RegisterHotKey`).

**Complex** (defer indefinitely):
- Projects (multi-workspace data model + per-project history), project knowledge RAG, artifacts preview sandbox, `.mcpb` extension installer, custom styles trained on writing samples.

## 4. HarnessX implementation sketch (v1 features)

How the copied features compose into the request HarnessX sends:

```
finalSystemPrompt =
    [global instructions from Settings]       (if set)
  + [style preset snippet]                    (if not "Normal")
  + [per-chat system prompt]                  (if set)
messages = [{role:"system", content: finalSystemPrompt}, ...chat turns]
```

- Settings screen: one "System instructions" textarea (global), stored in app settings JSON.
- Chat sidebar: "System prompt" textarea (per-chat, saved in the chat's JSON) + Style dropdown.
- Style snippets are just constants, e.g. Concise = "Keep responses short and direct. Skip preamble and caveats unless essential."
- Store chats as one JSON file each under `%USERPROFILE%\.harnessx\conversations\` (same convention as the LM Studio plan), so history + search is a folder scan.
