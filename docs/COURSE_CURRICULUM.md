# HarnessStation — The Complete Video Course

*A curriculum for a YouTube / website video series teaching HarnessStation from
zero to advanced. Written 2026-08-03, against the app as built: Tauri v2 +
React 19/TypeScript, Rust backend, Windows and Linux desktop plus a browser
build.*

---

## Who this is for

Viewers who want a model to actually *do* things on their own machine — read
files, run commands, browse the web, remember context, and act on a
schedule — rather than a chat box. Some episodes assume nothing; the advanced
and developer tracks assume the viewer has already used the app for real work.

## Prerequisites

- A Windows 10/11 or Linux desktop (the app doesn't ship for Mac).
- No prior AI-app experience required for the beginner track.
- For the developer track: comfortable reading TypeScript/React and some Rust.
- Optional but useful before recording: an API key for one cloud provider
  (OpenAI or Anthropic) *and* Ollama or LM Studio installed locally, so both
  routes in Episode 3 can be shown live.

## What viewers can do by the end

Run the app with either a free local model or their own cloud key; hold a
typed or spoken conversation that reads their files, browses the web, and
remembers facts across sessions; build reusable agents, multi-step workflows,
and schedules; connect MCP servers and a device mesh; run a fully local
model with tuned llama.cpp flags; understand the browser build's in-tab Linux
VM, Python and speech stack; and — for developer-track viewers — extend the
app's tools and understand the Tauri↔web shim architecture well enough to
contribute.

## How this curriculum is organized

Four tracks, each broken into modules, each module broken into short, single-topic
lectures. Record in numeric order within a track; tracks can be released as
separate playlists. Every lecture lists: objective, on-screen steps, and
gotchas worth saying out loud on camera.

- **Track A — Beginner** (Modules 1–4): install through first working agent.
- **Track B — Intermediate** (Modules 5–11): voice, MCP, tools, projects,
  knowledge, workflows, agents, schedules, browser, settings deep-dive.
- **Track C — Advanced** (Modules 12–16): local models + llama.cpp tuning,
  device mesh, the web build (VM/Python/STT-TTS), rewind & context surgery,
  deployment/updates.
- **Track D — For developers** (Modules 17–19): architecture, the Tauri↔web
  shim seam, contributing.

Total: **19 modules, 74 lectures.** See the runtime table at the end.

---

# TRACK A — BEGINNER

## Module 1 — Install and orientation

### E01. What HarnessStation actually is
**Duration:** 4 min
**Objective:** Set expectations before installing anything — what the app does, what it deliberately doesn't do, and who it's for.
- Show the README's one-line pitch: "a desktop app for running AI models as agents."
- Draw the distinction on screen: it supplies tools, files, knowledge, memory, browser, voice — the model is *brought* by the viewer (local via Ollama/LM Studio, or cloud via their own key).
- State plainly: no API keys ship with the app, no account, no telemetry, no cloud sync.
- Preview the seven feature areas from the README (conversations, tools, knowledge, memory, voice, browser control, automation, MCP, device mesh, models) as a checklist for the series.
- **Gotcha:** it's early software — say so on camera rather than overselling; the docs themselves call out rough edges deliberately.

### E02. Installing on Windows
**Duration:** 5 min
**Objective:** Get the app running on Windows, including the unsigned-binary warning viewers will definitely hit.
- Download the installer, run it.
- Show the "Windows protected your PC" SmartScreen box appearing — explain it's expected because the app isn't code-signed yet, not a sign of a problem.
- Click **More info → Run anyway**.
- Mention WebView2 is already on Win10/11, so no extra runtime is needed.
- **Gotcha:** if a viewer doesn't want to run unsigned software, point to building from source (covered in E04).

### E03. Installing on Linux
**Duration:** 4 min
**Objective:** Install via AppImage or .deb, and fix the most common launch failure.
- `chmod +x` and run the AppImage; alternatively `dpkg -i` the .deb.
- Show the fix for "AppImage won't start": `apt install libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0`.
- Mention the optional `espeak-ng` / `speech-dispatcher` package for system-voice speech (Kokoro doesn't need it).

### E04. Building from source (optional deep-dive)
**Duration:** 7 min
**Objective:** Show the from-source path for viewers who want to audit or avoid the unsigned binary, and set up the dev loop used throughout the developer track.
- Prerequisites: Node 18+, Rust via rustup, a C++ toolchain (VS2022 Build Tools + C++ workload on Windows, `build-essential` on Linux).
- `npm install`, `npm run tauri dev`, `npm run tauri build`.
- Note the first Rust build compiles several hundred crates and takes minutes; later builds are incremental.
- Run `npm test` (493 tests) and `npx tsc --noEmit` to show the project has a real test suite — useful credibility beat for the developer track later.

### E05. Where your data lives, before you put anything in it
**Duration:** 5 min
**Objective:** Show the `~/.harnessx` folder layout up front so nothing that follows feels like a black box.
- Open `~/.harnessx` (or `%USERPROFILE%\.harnessx`) in a file browser: `settings.json`, `conversations/`, `presets/`, `snapshots/`, `exports/`, `agent-memory/`, `avatars/`, `models/`, `engines/`, `tmp/`.
- Open a chat's JSON file directly to show it's plain, readable text — no database.
- Explain the one deliberate exception: **API keys are not in this folder** — they live in the OS credential store (Windows Credential Manager / Linux Secret Service).
- **Gotcha:** don't edit these files while the app is running — it holds chats in memory and will overwrite hand-edits on next save.

## Module 2 — Your first conversation

### E06. Connecting a free local model (Ollama)
**Duration:** 6 min
**Objective:** Get a zero-cost model talking to the app, for viewers who want to try everything before spending money.
- Install Ollama, `ollama pull qwen3`, confirm `ollama serve` is running.
- Open **Settings › Providers**; show local auto-detection finding it on `localhost:11434/v1`.
- If not auto-detected, add it by hand: base URL `http://localhost:11434/v1`, empty API key.
- Press **Save**, then **Fetch models** to list what's available.
- **Gotcha:** LM Studio is the GUI alternative — its server has to be started manually from the **Developer** tab; show that too as a quick aside.

### E07. Connecting a cloud provider with your own key
**Duration:** 5 min
**Objective:** Add a paid provider correctly and understand exactly where the key goes.
- **Settings › Providers › Add provider**: Name, Base URL (`https://api.openai.com/v1` or similar), API key.
- Point at the table of common providers (OpenAI, Anthropic, OpenRouter, Groq, Together) and their base URLs.
- Explain the key is written to the OS credential store, not to `settings.json`, and is sent only to that provider.
- **Gotcha:** Anthropic is a native integration (`/v1/messages`), not OpenAI-compatible — mention this only if a viewer asks why it's listed separately.

### E08. Sending your first message
**Duration:** 3 min
**Objective:** Close the loop from install to a working reply.
- Pick a model from the selector atop the chat, type a message, press Enter.
- Show the streaming markdown/code-block rendering.
- Cover the three failure states viewers will hit and their fixes: "No provider configured", "Connection refused" (local server not started), 401/403 (bad key or no credit).

### E09. Giving it a tool — the moment the app becomes an agent
**Duration:** 6 min
**Objective:** Demonstrate the call → read → respond loop live, the single most important "aha" of the whole series.
- Open the tools panel on the right of the chat, switch on **Files**.
- Set a working directory when prompted — explain this is a hard boundary, the model cannot see outside it.
- Prompt: "Read the README in this folder and tell me what the project does."
- Point out the tool-call card that appears in the conversation: the call, its arguments, and its result, all inspectable.
- **Gotcha:** small local models often can't call tools reliably regardless of what their model card claims — if this step fails on a local model, that's the likely cause, not misconfiguration. Test with a bigger model before assuming something's broken.

### E10. A tour of the sidebar
**Duration:** 8 min
**Objective:** Map every panel so later episodes can go deep without re-orienting.
- New chat vs. New call (spoken) at the top; search below it.
- **Projects** — one-sentence preview, full episode later.
- **Chats** — pin, rename, folder, duplicate, snapshot, export, delete.
- **Library**: Discover, My Models, Compare, Evals, Benchmarks.
- **Automation**: Agents, Skills, Knowledge, Tools, Workflows, Schedules, MCP Servers, Browser.
- The composer: Attach, Dictate, Compact, Regen.
- The per-chat right-hand panel: model, temperature, system prompt, tools, working directory.
- Settings: eight panels, with a search box that matches on what a setting *does* (e.g. typing "interrupt" finds barge-in).

## Module 3 — Mental model

### E11. What actually happens on a turn (the agent loop)
**Duration:** 7 min
**Objective:** Give viewers the model that explains almost every "why did it do that" moment for the rest of the series.
- Draw the loop: assemble prompt → send with tool list → model replies (text or tool call) → if tool call, run it and loop → if text, stop.
- Show that each pass round the loop is a separately billed request — why an 8-tool-call task costs far more than a single question.
- List, in order, everything that goes into the prompt: global instructions, project instructions, chat instructions, recalled memory, retrieved knowledge, skill index, tool definitions, conversation history, your message last.
- Explain the five reasons the loop stops: it answered; it hit the step limit; it repeated itself unproductively; you stopped it; a spend cap was reached; it errored.
- **Gotcha:** instructions layer, they don't replace — a chat prompt doesn't override the global one; contradictions between layers are the commonest cause of an ignored instruction.

### E12. Where things actually run — the local/cloud split
**Duration:** 5 min
**Objective:** Make the local-vs-cloud privacy boundary concrete, not abstract.
- On your machine: interface, all file/terminal work, tool execution, Whisper transcription, local speech synthesis, the browser panel, all storage.
- On the provider: the model only — it receives the assembled prompt and returns text; it never touches files directly.
- Walk the "what leaves your machine" table for five real setups: local-model-no-tools, local-model+local-embeddings, cloud model, cloud embeddings, cloud voice.
- **Gotcha:** cloud embeddings upload *every* document in a knowledge base, not just retrieved passages — the single most surprising row in that table, worth its own beat.

### E13. Getting better results out of it
**Duration:** 8 min
**Objective:** Teach the handful of prompt patterns that measurably help with tool-using agents, on camera with before/after examples.
- Say what you don't want ("skip style, only bugs").
- Give explicit permission to find nothing — the fix for padded, low-signal output.
- Ask it to show its evidence / quote sources — the main defense against confident invention.
- Ask for a plan before multi-file work.
- Work in small steps rather than one long ask.
- Say what to do when stuck (ask vs. assume-and-flag).
- What doesn't help: politeness, "you are a senior engineer" framing, very long instructions, repeating an ignored instruction.
- **Gotcha:** repeating an ignored instruction rarely works — something else in the prompt is probably contradicting it; go back to E11's layering model.

## Module 4 — First real agent

### E14. End-to-end: working with a codebase
**Duration:** 10 min
**Objective:** A full worked use-case combining everything from Track A — files tool, working directory, prompting patterns — on a real repository.
- Set the working directory to a real project folder.
- Understand unfamiliar code with a scoped question.
- Review a diff / recent change.
- Make a small, contained edit and watch the tool-call cards.
- Apply E13's "plan before work" pattern on a multi-file change.
- **Gotcha:** point at the failure modes the docs call out — vague requests cause wasted exploration; be specific about which file.

---

# TRACK B — INTERMEDIATE

## Module 5 — Voice

### E15. Starting a call
**Duration:** 6 min
**Objective:** Hold a first spoken conversation end to end.
- Press **New call**; explain the two things a call needs — hearing (Whisper, local) and speaking (an engine, covered next episode).
- First-call Whisper model download; contrast `tiny`/`base`/`small`.
- The three input modes: Auto (continuous listening, best with headphones), Push-to-talk (**Ctrl+Shift+V**, global — works from any app), Wake word.
- End the call, show it saved as a chat and reopens as a call.
- **Gotcha:** an aborted call with no exchange isn't saved — a mis-press doesn't leave clutter.

### E16. Voice engines — picking a voice
**Duration:** 7 min
**Objective:** Compare the four synthesis engines and land on a sensible default.
- Walk the table: Kokoro (free, local, very good, English-only), Cloud (best, per-character, OpenAI/ElevenLabs/Cartesia/Groq), Piper (free, local, lighter/faster, more synthetic), System (free, instant, flattest, but the only offline route for many languages), Auto.
- Demo Kokoro live — mention the one-time ~90 MB download and that speech generates a sentence at a time so long replies start speaking immediately.
- Show a cloud engine with a key, and the graceful-fallback behavior if the request fails.
- **Gotcha:** Kokoro and Piper are English-only; non-English needs cloud or a system voice with that language installed.

### E17. Barge-in, interruption, and making it sound less robotic
**Duration:** 6 min
**Objective:** Tune a call to feel like a conversation rather than a sequence of announcements.
- Turn on barge-in; demonstrate talking over the avatar to interrupt it.
- **Gotcha (important, demo it):** barge-in through speakers makes the app hear its own voice and interrupt itself constantly — requires headphones to work correctly.
- Settings › Voice: Human delivery, Expressiveness (0/1/2), Persona, Speech rewrite (a small model rewrites replies for the ear — numbers as words, no markdown, shorter sentences).
- Show the level meter and silence-timeout / smart-endpointing controls for "it hears me but doesn't reply."

### E18. 3D avatars — VRM and MMD
**Duration:** 8 min
**Objective:** Put a character on screen instead of the default orb, and understand the licensing question before recommending a source.
- Settings › Voice › On-screen character; switch from orb to a VRM.
- Import a model from VRoid Hub or the in-app Open Source Avatars (CC0) browsable list; show **Import**.
- Explain MMD (`.pmx`) needs its texture folder alongside it, so it's imported as a `.zip`.
- Cover licensing plainly: VRoid Hub models carry per-creator conditions (commercial use, modification, "corporate" use); CC0 sources and self-made VRoid Studio models are the safe default for anything shown publicly.
- **Gotcha:** mouth movement follows speech *volume*, not phonemes — call this out as a known limitation, not a bug to troubleshoot; performance note: switch to the orb on battery or integrated graphics.

## Module 6 — MCP servers

### E19. Connecting your first MCP server
**Duration:** 7 min
**Objective:** Connect a real MCP server over stdio and understand the two transports.
- **Automation › MCP Servers › Add server**.
- stdio example: an npx-launched server with an env var token (e.g. GitHub).
- http example: a remote server, OAuth sign-in flow, token stored in the credential store.
- **Gotcha:** for npx servers, run the command once in a real terminal first — the first run downloads the package and can time out inside the app.

### E20. Progressive disclosure — why ten servers don't flood the model
**Duration:** 6 min
**Objective:** Explain the app's specific solution to the "too many tool definitions" problem, since it's genuinely unusual.
- The naive cost: N servers × M tools each = a huge, ever-growing block of tool definitions sent on every request.
- The four meta-tools the app actually exposes: `mcp_servers`, `mcp_tools`, `mcp_describe`, `mcp_call`.
- Demo the model narrowing down live: ask for a capability, watch it call `mcp_servers` then `mcp_tools` then act.
- **Gotcha:** this costs an extra round-trip or two before the first real call — a good trade past about two connected servers, worth saying the tradeoff out loud.

### E21. Troubleshooting MCP connections
**Duration:** 4 min
**Objective:** Fast triage for the three failure modes viewers will actually hit.
- Server won't start → test the command in a real terminal.
- Connected but no tools listed → disconnect/reconnect (some servers expose tools only post-init).
- Auth failures → check `env` token for stdio; redo the OAuth flow for http.

## Module 7 — Tools, in depth

### E22. The built-in tool groups
**Duration:** 8 min
**Objective:** Walk every built-in tool group so viewers know the full toolbox, not just Files.
- Table walk: Files, Terminal, Web, Browser, Media, MCP, Skills, Agents, Workflows, UI, Swarm.
- Demo Terminal with a real command in the working directory; state plainly on camera that a working directory limits *files*, not what a command can reach over the network.
- Demo Web fetch/search briefly.
- **Gotcha:** every tool is off by default in every chat — there is deliberately no "enable everything" switch; enabling is per-conversation, and an agent (Module 10) is how you make a set of tools reusable.

### E23. Writing your own JavaScript tool
**Duration:** 8 min
**Objective:** Build a custom tool end to end and show why the description field is the real interface.
- **Automation › Tools › New tool**: name, description, JSON Schema parameters, JavaScript body.
- Write a small tool (e.g. a unit converter or a fake order lookup) live.
- Contrast a vague description ("Looks up an order") with a good one ("Look up an order by its ID... Use when the user mentions an order number") and explain the model is choosing purely from that text.

### E24. Writing your own Python tool
**Duration:** 6 min
**Objective:** Same as E23 but Python, and the one extra requirement it has.
- Same New Tool flow, Python body this time (e.g. hitting a real HTTP API with `urllib`).
- **Gotcha:** Python tools need Python on PATH on desktop; parameter schema is auto-detected from code where possible but should be checked by hand.

### E25. Auto-enabling tools, and reading what a tool actually did
**Duration:** 5 min
**Objective:** Cover the semi-automatic option and the habit of reading tool-call cards.
- Settings › General → "let the model switch on tools it finds itself" — explain the credential boundary (it can turn on file search, it cannot connect something needing your API key).
- Show expanding a tool-call card mid-conversation and reading the exact arguments that produced a surprising result.
- **Gotcha:** forty enabled tools choose worse than five — this is a recurring theme across agents, workflows, and cost; flag it here so later episodes can reference it.

## Module 8 — Projects

### E26. Creating a project and understanding what it isolates
**Duration:** 7 min
**Objective:** Show projects solving the specific problem of context bleeding between unrelated work.
- **+** beside Projects; set Instructions, Knowledge bases, Tools.
- Walk the two-client worked example from the docs (Acme/Brightside) live with two small projects.
- Show a chat inside a project inheriting instructions automatically, and one outside seeing neither.
- **Gotcha:** deleting a project does not delete its chats by default — they return to the ungrouped list; only project *memory* is deleted with it.

### E27. Instruction layering across global / project / chat
**Duration:** 5 min
**Objective:** Make the three-layer instruction stack (introduced conceptually in E11) concrete with a project in front of you.
- Add a global instruction, a project instruction, and a chat instruction that overlap, and show all three appearing in a reply.
- Diagnose: "facts from one project appear in another" → check Settings › Memory for scope; "a chat isn't picking up project instructions" → it isn't in the project yet.

## Module 9 — Knowledge

### E28. Building your first knowledge base
**Duration:** 8 min
**Objective:** Index real documents and get a grounded answer instead of a guess.
- **Automation › Knowledge › New knowledge base**, add a few PDFs/Markdown files.
- Set an embedding model first in **Settings › Providers › Embeddings** — show the local option (Ollama `nomic-embed-text`, free, private) vs. cloud (`text-embedding-3-small`, cheap but uploads every document).
- Attach the base to a chat and ask a question; show retrieval happening automatically, no explicit "search" instruction needed.
- **Gotcha:** changing the embedding model invalidates existing indexes — pick one before importing a lot, re-indexing is not incremental.

### E29. How retrieval actually works, and getting better answers from it
**Duration:** 7 min
**Objective:** Explain chunking/embeddings well enough that viewers can predict when retrieval will and won't work.
- Explain chunk → embed → nearest-neighbor at question time; why "undoing a deploy" finds "rolling back a release."
- Three structural limits: not exhaustive (nearest chunks, not all relevant ones), chunk-boundary splitting, meaning- not keyword-based.
- Better-results checklist: use the documents' own vocabulary, ask narrow questions, explicitly ask it to say when something's absent, split unrelated material into separate bases, name bases descriptively.
- **Gotcha:** a scanned PDF is an image with no text — the app does no OCR, so it silently returns nothing useful for one.

## Module 10 — Agents, Skills, and Workflows

### E30. Creating your first agent
**Duration:** 8 min
**Objective:** Package a role — instructions, model, tools, knowledge, working directory — as one reusable thing.
- **Automation › Agents › New agent**: name, instructions, model, tools, knowledge, working directory.
- Build a concrete example (e.g. a code reviewer agent) with specific, detailed instructions — contrast "You review code" with a real spec.
- Run it directly from the Agents panel.

### E31. Running an agent from inside a chat, and agent memory
**Duration:** 6 min
**Objective:** Show delegation from a normal conversation, and the separate memory each agent keeps.
- Turn on the **Agents** tool group in a chat; ask the model to hand a subtask to a named agent, and watch the delegated output stay out of the main conversation.
- Explain agent memory is separate from chat/project/global memory — it accumulates what that agent specifically has learned.
- Writing-instructions checklist: be specific about scope, say what output format you want, minimum necessary tools, say what to do when stuck.

### E32. Swarms — several agents on one job
**Duration:** 6 min
**Objective:** Cover the multi-agent coordination feature and when it's actually worth the extra cost.
- Turn on **Swarm**; frame it as genuinely parallel work (reviewing twelve files at once) vs. sequential work (where it's slower and dearer than a single agent).
- Mention the shared view of which files each agent is touching, and that a second agent is told when a file it depends on changes.
- **Gotcha:** flag cost here explicitly — several agents means several conversations running at once; not a default choice.

### E33. Skills — reference material loaded on demand
**Duration:** 7 min
**Objective:** Teach the difference between "put it in global instructions" (paid every message) and "put it in a skill" (paid only when relevant).
- **Automation › Skills › New skill**: name, one-line description, Markdown body.
- Build the SQL-conventions worked example from the docs live.
- Description-writing rule: describe *when* to use it, not what it contains — show a good vs. bad description side by side.
- Distinguish skills (procedures, loaded whole) from knowledge (large material, searched) and memory (facts about the user, always injected).

### E34. Building a multi-step workflow
**Duration:** 9 min
**Objective:** Chain steps so one step's output feeds the next, and show why splitting beats one long prompt.
- **Automation › Workflows › New workflow**; build the "weekly repo summary" three-step example (Gather → Group → Write) live, each with its own tools/model.
- Run it, and read each step's output as it completes.
- Reliability habits: tell early steps not to summarize ("return the output unchanged"), have steps signal failure explicitly ("if no results, reply exactly: NO DATA").
- **Gotcha:** a workflow is for a *known shape*; if the next step depends on what's discovered, a chat with tools does better — reiterate the agent-vs-workflow-vs-chat decision table.

### E35. Agents vs. workflows vs. plain chats — the decision table
**Duration:** 4 min
**Objective:** A short, standalone reference episode so viewers can jump straight here later without rewatching E30–E34.
- One job, one role, repeated → an agent.
- Fixed sequence, output feeding forward → a workflow.
- Open-ended, judgment about what's next → a chat with tools.

## Module 11 — Schedules, Browser, and Settings deep-dive

### E36. Scheduling an agent or workflow
**Duration:** 8 min
**Objective:** Get something running unattended safely, with the guardrails set up first — in that order.
- **Automation › Schedules › New schedule**: what to run, interval presets vs. cron, where results land (new chat / append / notification).
- Set a spend cap in **Settings › Usage** *before* the first scheduled run — frame this as a hard prerequisite, not a suggestion.
- Turn on **keep running in the tray** (Settings › General) — explain a missed run does not fire retroactively.
- Build the "morning briefing" worked example, including the "say nothing needs you today" instruction that keeps a daily digest worth opening after a fortnight.
- **Gotcha:** good candidates report; poor candidates act unreviewed (sending mail, posting, committing) — draft-and-tell beats do-it-automatically.

### E37. Cron expressions for irregular schedules
**Duration:** 3 min
**Objective:** Quick reference for the non-preset cases.
- Walk 4 example expressions live: weekday mornings, every 4 hours, monthly, Friday evening.

### E38. Browser control — the in-app browser
**Duration:** 8 min
**Objective:** Drive a real, model-visible browser inside a conversation.
- Turn on the **Browser** tool group; ask it to open a page and summarize something on it.
- Walk the tool list: `open_url`, `read_all_text`, `find_text`, `list_buttons`, `click_button`, `take_screenshot`/`read_screenshot`.
- Explain why it's a real positioned browser window, not an iframe — cross-origin iframes can't be scripted and most real sites refuse framing anyway; this is also why the panel holds still below the chat instead of scrolling with it.
- **Gotcha:** the in-app browser cannot screenshot — that needs the extension (next episode); it also has one view, not tabs.

### E39. Driving your own Chrome via the extension
**Duration:** 6 min
**Objective:** Use sessions the viewer is already signed into, for tasks the in-app browser's clean session can't reach.
- Enable Developer mode on `chrome://extensions`, **Load unpacked**, select the repo's `extension/` folder.
- Compare when to use this vs. in-app: a login already established elsewhere vs. a clean/disposable session.
- Tab tools only available here: `open_new_tab`, `list_tabs`, `change_tab`, `close_tab`.
- **Gotcha:** treat a signed-in session in either browser as delegated access — the model can act on any site you're signed into within it.

### E40. Images, audio, video and 3D generation
**Duration:** 8 min
**Objective:** Connect a media-generation engine and generate on-camera, including the free local route.
- **Settings › Media models › Add model**: OpenAI-compatible image, Stable Diffusion webui (free, local, needs `--api`), OpenAI-compatible speech, Replicate (widest choice, image/audio/video/3D).
- Generate an image live with the Media tool group on; show prompting tips (say what you don't want, name the aspect ratio) and letting the model write its own prompt.
- Set up A1111/Forge with `--api` for free local images if a GPU is available (~6GB VRAM for SDXL).
- **Gotcha:** video and 3D via Replicate are considerably slower and dearer than images — worth stating before anyone leaves an agent generating video unattended.

### E41. Comparing models side by side
**Duration:** 5 min
**Objective:** Use Compare to answer "is the expensive model actually better for this" in under a minute.
- **Library › Compare**: one prompt, several models, replies side by side with token counts and cost.

### E42. Public benchmarks, and their limits
**Duration:** 4 min
**Objective:** Use Benchmarks to shortlist, understand why it's the one thing the app fetches for you, and why not to stop there.
- **Library › Benchmarks**; explain the gateway that serves this needs no key of the viewer's and carries no data about them.
- State the limitation plainly: public benchmarks are contaminated by training data and are a weak proxy for a viewer's actual task — shortlist with them, then test with Evals.

### E43. Building your own eval set
**Duration:** 9 min
**Objective:** Build a small, representative eval set and use it to make a real switching decision.
- **Library › Evals**: define test cases (prompt + what a good answer looks like), run against a model, read scored results.
- Build 3–4 real test cases live, including one where the right answer is "I don't know."
- When to re-run: a new model appears, a prompt/agent instruction changed, a provider silently updated a model behind the same name, considering a cheaper model.
- Reading results honestly: a small score gap is noise; look at *how* it fails, not just how often; factor in cost and speed.

### E44. Settings, panel by panel
**Duration:** 10 min
**Objective:** A single deep-dive episode covering every settings panel, so later episodes can link back to it instead of re-explaining.
- Walk all eight panels: General, Providers, Media models, Voice, Memory, Devices, Usage, Data & updates.
- Show the settings search box matching on behavior, not label ("interrupt" → barge-in).
- Show the draft/Save model — unsaved marker, Ctrl+S, confirm-before-discard on navigating away.
- Highlight the "settings most worth changing" list: spend caps, voice engine, speech rewrite, auto-compact, embedding model, background mode, memory share.
- Cover the "things people expect and won't find": per-tool default model, global enable-all-tools, cloud sync, memory share above 25%. Each is a deliberate absence — explain why briefly.

### E45. Memory — three scopes and the budget
**Duration:** 8 min
**Objective:** Understand passive memory extraction and the context-window budget that keeps it from crowding out the conversation.
- Table: chat scope, project scope, global scope, and what belongs in each.
- Passive memory (Settings › Memory) vs. saying "remember that..." deliberately.
- Show **Settings › Memory** listing facts by scope, deleting one, and **Tidy** merging near-duplicates.
- The budget: 20% of context window by default, 25% max, hard-capped by design; explain the consequence that a smaller model recalls less because the budget is a *share* of its window.
- **Gotcha:** memory ≠ knowledge — a style preference is memory, a 200-page spec is knowledge; putting a document into memory blows the whole budget on one file.

### E46. Chats — folders, snapshots, branching, and compaction
**Duration:** 9 min
**Objective:** The chat-management features viewers need once they have real history to manage.
- Right-click menu: pin, rename (vs. auto-title), move to folder, duplicate, export (Markdown vs. JSON), delete (no undo).
- Take a snapshot before a risky tool-using task; restore it; explain the chat keeps its identity.
- Branch from a message vs. edit a message — when each is the right move.
- Compact: the banner, what's kept vs. folded, and turning on auto-compact with a threshold.
- **Gotcha:** compacting loses detail on purpose — anything the viewer will want verbatim later belongs in an export or in memory, not left to survive compaction.

### E47. Controlling cost
**Duration:** 9 min
**Objective:** Explain why agent work costs more than chat, and the handful of levers that actually move the number.
- The loop-cost math from E11 restated concretely: 8 tool calls = 9 requests, and the 9th resends everything from the first 8.
- Where the money goes: input tokens (instructions, memory, retrieved passages, tool defs, whole history) — not the reply.
- What actually saves money, ranked: smaller model for most things, compact long chats, start fresh chats for new topics, fewer enabled tools, specific requests, split large tasks.
- What doesn't help much: shortening the user message, disabling memory, avoiding tools altogether.
- Set caps in **Settings › Usage** live; show the "reached" behavior (stop rather than continue silently).
- **Gotcha:** the underrated cost sinks — scheduled runs, swarms, long browser sessions (every page read is resent every subsequent request), image/video generation.

---

# TRACK C — ADVANCED

## Module 12 — Local models and llama.cpp tuning

### E48. Choosing a local model for your hardware
**Duration:** 7 min
**Objective:** Match model size to RAM/VRAM realistically, and set expectations about the local/cloud quality gap.
- Walk the sizing table: 8GB→3-4B, 16GB→7-8B, 32GB→14B, 64GB+→32-70B (4-bit quantized).
- Emphasize tool-calling reliability as the actual bottleneck, more than prose quality — test early with the README-summarize prompt from E09.
- Show mixing local + cloud per chat: local for everyday/private work, cloud for hard reasoning.

### E49. Discover and My Models — downloading a GGUF locally
**Duration:** 9 min
**Objective:** Walk the app's own local-model download path (distinct from Ollama/LM Studio), using the real Discover UI.
- **Library › Discover**: search GGUF models by name, or paste a Hugging Face URL directly (`.../resolve/main/<file>.gguf`).
- Show a download with progress, landing under `~/.harnessx/models`.
- **My Models**: the local-models list, load defaults, "will it fit" indication tied to detected RAM/VRAM.
- Cover the underlying Rust mechanics briefly for credibility: `hw_info` detects total RAM, AVX2, and an NVIDIA GPU via `nvidia-smi`; downloads stream to a `.part` file and are renamed on completion; archives are extracted in-process (zip and tar.gz) with path-traversal protection.

### E50. Loading and running a local model — context length and GPU offload
**Duration:** 7 min
**Objective:** Load a downloaded model into the supervised llama-server and tune the basics.
- Load/Eject from My Models; context-length and GPU-offload-layers controls; estimated memory readout.
- Show the chat's provider picker gaining a "Local" entry that talks to the supervised server over the same OpenAI-compatible client used for cloud providers.

### E51. Advanced llama-server launch flags
**Duration:** 10 min
**Objective:** Go under the hood of the actual llama.cpp flags the app can pass, for viewers who want to squeeze performance out of specific hardware — this is genuinely advanced and code-literate content.
- Walk each opt-in flag and what it's for: `--threads` (CPU thread count, best near physical core count), `--cpu-moe` / `--n-cpu-moe N` (offload all or the first N MoE expert layers to system RAM — the trick for running a big MoE model on a small GPU by keeping attention on GPU and experts in RAM), `--flash-attn on` (near-universal speed/memory win), `--mlock` (pin in RAM, no swap), `--no-mmap` (load fully into RAM instead of memory-mapping), `--fit off` / `--fit-target` (llama.cpp's auto-fit and its memory margin).
- Explain the compatibility design: every flag is opt-in and nothing is emitted for an unset field, so an older llama-server build that doesn't recognize a newer flag (like `--n-cpu-moe` or `--fit-target`) still launches cleanly.
- Show the actual unit tests in `src-tauri/src/local.rs` (`launch_tests` module) proving this — a nice beat for the developer-curious viewer even inside the advanced track.
- **Gotcha:** these flags only take effect on engines new enough to know them; if a flag has no effect, check the llama-server build version first.

## Module 13 — Device mesh

### E52. Turning on and pairing the mesh
**Duration:** 8 min
**Objective:** Pair two machines the viewer owns and understand exactly what pairing does and doesn't grant.
- **Settings › Devices**: name the machine, **Turn on**, optional start-with-app.
- LAN auto-discovery vs. adding a machine by address.
- Pairing flow: **Show pairing code** on the target machine (valid 5 minutes, single-use), enter code + address on the initiator. Explain neither the code nor the resulting long-lived token ever crosses the network in the clear — a proof-of-knowledge handshake.
- **Gotcha, say this one loud and clear on camera:** mesh traffic itself is NOT encrypted yet — the handshake protects credentials and blocks replay, but prompts, tool output, and retrieved documents travel in plaintext after that. Fine on a home LAN; across the internet, only inside a VPN/tunnel (Tailscale, WireGuard, SSH) — never a forwarded port.

### E53. What gets shared, and what never does
**Duration:** 6 min
**Objective:** Walk the three sharing switches and the hard-coded exclusions, so viewers configure the mesh deliberately rather than by default.
- Three off-by-default switches: Models (run inference using the remote machine's keys/GPU), Tools (call tools there), Knowledge (search knowledge bases stored there).
- **Shell, Python, and file-writing tools are never shared, regardless of the Tools switch** — emphasize this is a hard boundary in the design, not a setting.
- Show **What can it do?** on a paired device, and its models appearing alongside local ones in the model picker.
- Troubleshooting: both ends need mesh on; discovery is a broadcast some networks (guest/corporate Wi-Fi) block, so add by address; port 8793 (mesh) / 8794 (announce) for firewall rules; sleeping machines correctly show offline.

## Module 14 — The web build

### E54. Running HarnessStation in a browser tab
**Duration:** 6 min
**Objective:** Stand up the web build and explain the architectural trick that makes it possible with zero UI fork.
- `npm run web:dev` → `http://localhost:5175`.
- Explain the shim seam: the desktop app talks to Rust through five `@tauri-apps/*` imports (`core`, `plugin-fs`, `plugin-http`, `api/event`, `plugin-opener`, `plugin-updater`); the web build aliases each to a browser implementation in `web/shims/` — same `src/` tree, same features, no forked UI.
- Show the shim table on screen: `core.ts` (command dispatcher), `fs.ts` (OPFS), `http.ts` (native fetch, so CORS applies), `event.ts` (local no-op bus), `secret.ts` (browser secret store).
- State clearly what still can't run in a tab: local models (mixed content — https can't reach localhost), stdio MCP, the device mesh, the native in-app browser — these fail as ordinary "not available" errors rather than crashing.

### E55. Voice in the browser — Whisper and Kokoro without a server
**Duration:** 7 min
**Objective:** Show the browser build doing real local speech recognition and synthesis with no backend at all.
- Voice input: `getUserMedia` capture (`mic.ts`) → 16kHz WAV written to OPFS → transformers.js Whisper (`whisper.ts`) — same record-then-transcribe flow as desktop, running entirely client-side.
- Voice output: Kokoro (already WASM, so it just works), cloud engines, or the browser's own SpeechSynthesis as the system-voice equivalent (`speak.ts`).
- Demo a full spoken exchange in a plain browser tab with no Tauri process behind it.

### E56. Python in the browser via Pyodide
**Duration:** 6 min
**Objective:** Run a real Python tool inside the web build.
- `pyodide.ts` loads real CPython from CDN on first use.
- Write and run a small Python tool (reuse the E24 example) inside the web build; show it executing without any server round-trip.

### E57. The OPFS workspace and the coreutils shell
**Duration:** 6 min
**Objective:** Understand the sandboxed file layer that backs Files/Terminal in the browser before introducing the full VM.
- `vfs.ts`: a persistent, sandboxed workspace in the Origin Private File System — a path can't escape it.
- `shell.ts`: a coreutils subset (ls, cat, echo, grep, pipes, redirection, `&&`/`;`, cd) operating over that same workspace — this is the default terminal in the browser build.

### E58. A real Linux VM in the tab, via v86
**Duration:** 10 min
**Objective:** Demonstrate the genuinely advanced feature — an actual Linux kernel booted client-side in a browser tab, with a real shared filesystem — and be honest about its cost.
- Turn on the real-Linux terminal toggle in Settings (off by default) — show `run_command` routing there instead of the coreutils shell shim.
- Explain what's booting: Buildroot + BusyBox under v86, an open-source x86-to-WebAssembly emulator, driven over its serial console — real `uname`, real busybox `grep`, real arbitrary guest programs.
- Explain why v86 over the faster CheerpX: v86 is BSD-licensed and free for commercial use; CheerpX is proprietary and would bill.
- Show the 9p filesystem bridge: the guest mounts the shared tree at `/mnt`, the model's OPFS workspace lives under `/mnt/workspace` — so files the file tools create and files a Linux command creates are literally the same files.
- State the costs plainly on camera: ~10MB one-time kernel download, a few seconds to boot, emulated execution is slower than native, headless/serial-only (no GUI).
- **Gotcha:** this is a genuinely new/experimental capability (per the recent commit history) — treat it as a "look what's possible" demo rather than a daily-driver recommendation, and mention the 40s boot / 30s per-command timeouts.

## Module 15 — Rewind and precise context control

### E59. Rewinding a conversation
**Duration:** 6 min
**Objective:** Use `rewindTo` to step a chat back to an earlier point, distinct from branching or editing.
- Demonstrate rewinding a conversation to an earlier index.
- Explain it snapshots before deleting, so a rewind is itself reversible.
- Contrast with **Branch from here** (E46): branching preserves the original and forks a new chat; rewind mutates the current chat back to an earlier state.

### E60. Deleting individual items from context
**Duration:** 8 min
**Objective:** Show the fine-grained "delete this from context" controls on reasoning, tool calls, and tool responses — a precision tool for cleaning up a long agent session without losing the whole thread.
- In a chat with tool use, hover a reasoning block → "Delete this thinking from context."
- Hover a tool call → "Delete this tool call from context"; hover its response → "Delete this tool response from context."
- Explain the use case: a long tool-using session accumulated noisy or wrong intermediate steps that are now poisoning the model's context, but the conversation is otherwise worth keeping — surgical deletion beats starting over or a full compaction.
- **Gotcha:** these controls are disabled while a reply is streaming — deletion only applies to settled history.

## Module 16 — Deployment and staying current

### E61. Updating and staying current
**Duration:** 4 min
**Objective:** Show the update flow and why a failed signature check is refused rather than silently applied.
- App checks for updates on startup; check manually in **Settings › Data & updates**.
- Updates are signed; a failed check is refused, not installed.

### E62. Uninstalling without losing your data
**Duration:** 3 min
**Objective:** Show the clean uninstall path and where the "actually delete everything" line is.
- Uninstall via Windows Settings or `dpkg -r`; the `~/.harnessx` folder is deliberately left behind.
- Delete `~/.harnessx` by hand to remove data entirely; mention `models/` and `engines/` are the large, re-downloadable folders worth excluding from backups.

### E63. Backing up and moving to a new machine
**Duration:** 5 min
**Objective:** A real backup/restore/migrate walkthrough.
- Compress `~/.harnessx` (tar.gz on Linux, Compress-Archive on Windows).
- Move to a new machine, re-enter keys (they're OS-credential-store-only, not in the folder).
- **Gotcha:** device identity is per-machine — a copied install keeps the old device id and will confuse the mesh (Module 13) if both machines run at once; re-pair from the new one.

### E64. Privacy and security checklist before showing this to anyone else
**Duration:** 8 min
**Objective:** A closing advanced-track episode consolidating every privacy/security point made across the series into one reference video.
- What leaves the machine, restated as a single table (from E12).
- Things worth being careful with: terminal tool reach, browser session delegation, unattended schedules, the mesh's plaintext transport, passive memory accumulation.
- Build a "private-by-default" configuration live: local model + local embeddings + Kokoro/Piper + Whisper + mesh off/LAN-only.
- Reviewing what an agent did after the fact: reading tool-call cards, grepping `~/.harnessx/conversations/` for a tool name or keyword.
- Sharing conversations safely: an export contains everything the model read, never your keys — read before sharing, because the risk is your codebase's contents, not credential leakage.

---

# TRACK D — FOR DEVELOPERS

## Module 17 — Architecture

### E65. Repository tour
**Duration:** 8 min
**Objective:** Map the repo before touching code.
- `src/` (React frontend — views, state, provider clients, tool implementations), `src-tauri/` (Rust backend — audio, MCP, browser bridge, mesh, keychain, speech), `extension/` (Chrome MV3), `server/` (benchmark-data gateway, optional), `docs-site/` (public docs), `docs/` (internal planning notes), `tests/` (Vitest suite), `web/` (browser build + shims).
- Inside `src/components/`: one file per major view (ChatWindow, ConfigPanel, Sidebar, McpView, SettingsView, VoiceView, ModelsView, DiscoverView, DevicesPanel, WorkflowsView, AgentsView, SchedulesView, ToolsView, KnowledgeView, SkillsView, EvalsView, BenchmarksView, CompareView, BrowserView, InlineBrowser, CodeEditor, Canvas, AvatarGallery, VrmAvatar, MmdAvatar, CommandPalette).
- Inside `src/lib/`: state (`store.ts`), providers (`providers/`), MCP (`mcp.ts`, `mcpGateway.ts`), memory (`memory.ts`, `memoryScopes.ts`), tools (`tools.ts`, `toolDiscovery.ts`), agents/workflows/schedule, mesh (`mesh.ts`, `meshHost.ts`, `meshRuntime.ts`), voice (`voice.ts`, `tts.ts`, `kokoro.ts`, `piper.ts`, `whisper.ts`, `sysvoice.ts`), cost/budget (`cost.ts`, `budget.ts`, `contextBudget.ts`), RAG (`rag.ts`), storage (`storage.ts`).

### E66. State management with store.ts
**Duration:** 7 min
**Objective:** Understand the app's central state shape well enough to find where a given feature lives.
- Read through the store's action surface for chats (send/regenerate/stop/branch/edit/rewindTo/deleteItem/compact) as a case study — these are the exact actions demoed in Modules 2, 11, and 15.
- Show how a UI component (ChatWindow.tsx) consumes store actions rather than owning logic.

### E67. The Rust backend surface
**Duration:** 8 min
**Objective:** Tour `src-tauri/src/` command by command.
- `local.rs` (hardware detection, downloads, extraction, working-dir file ops, terminal, whisper transcription/server, llama-server supervision — the file behind Module 12).
- `mesh.rs` (device mesh — the largest file, ~960 lines — behind Module 13).
- `mcp.rs`, `browser.rs` / `inapp_browser.rs`, `audio.rs`, `speech.rs`, `oauth.rs`, `secret.rs`, `py.rs`.
- Show `#[tauri::command]` as the boundary the frontend calls via `invoke()`.

## Module 18 — The Tauri↔web shim seam

### E68. Why one React tree runs on both desktop and web
**Duration:** 7 min
**Objective:** Explain the architectural decision that makes Module 14 possible, from the code side this time.
- Revisit the shim table from E54 with the actual source open: `web/shims/core.ts`, `fs.ts`, `http.ts`, `event.ts`, `opener.ts`, `updater.ts`, `secret.ts`.
- Show `registerCommand()` in `core.ts` and how a new Tauri command gets a browser implementation without touching any app code.

### E69. Case study: how the v86 Linux VM was added behind the seam
**Duration:** 9 min
**Objective:** Walk a real, recent, non-trivial feature addition as a template for contributing new capability behind the shim boundary — directly reference the actual commit history.
- Read through `web/shims/vm.ts`: the `Emulator` interface, the serial-byte watcher pattern (`onSerialByte`, `watchers`), the 9p bridge constants (`GUEST_MOUNT`, `SHARE_PREFIX`, `GUEST_WORKDIR`).
- Trace how `run_command` decides between the coreutils shell (`shell.ts`) and the real VM based on the Settings toggle — the actual conditional branch.
- Connect this to the three-commit sequence in the repo's own history: shell scaffold → VM milestone 1 (boot + run) → VM milestone 2 (wired into `run_command` with a shared filesystem) — a good narrative for "how to land a big feature incrementally."

### E70. Writing a new browser shim from scratch
**Duration:** 10 min
**Objective:** A hands-on exercise — implement a small new `invoke()`-backed command with both a Rust command and a browser shim, so a viewer leaves able to extend either side.
- Pick a small illustrative command (e.g. a "get clipboard text" command) and implement it twice: as a `#[tauri::command]` in `src-tauri/src/lib.rs`, and as a `registerCommand()` entry in `web/shims/core.ts`.
- Run it from both `npm run tauri dev` and `npm run web:dev` to prove the same call site works unmodified in both.

## Module 19 — Testing and contributing

### E71. Running and reading the test suite
**Duration:** 6 min
**Objective:** Show the existing 493-test Vitest suite and the Rust unit tests, and how they map to features already covered.
- `npm test`, `npx tsc --noEmit`.
- Revisit the `launch_tests` module inside `src-tauri/src/local.rs` from E51 as a concrete example of testing a pure function (`launch_flag_args`) extracted from something with side effects (`start_server`) specifically so it's unit-testable.

### E72. Adding a new built-in tool the "right" way
**Duration:** 9 min
**Objective:** Contrast a user-authored JS/Python tool (E23/E24) with adding a genuinely built-in tool group to the codebase — the contribution path a real PR would take.
- Locate where built-in tool groups are defined/registered (`src/lib/tools.ts`, `toolDiscovery.ts`).
- Add a minimal new tool, wire it into a tool group, and show it appearing in the per-chat tools panel.

### E73. Extending a view — adding a small feature to an existing panel
**Duration:** 8 min
**Objective:** A second contribution exercise focused on the UI layer, using one of the smaller, easier-to-grasp components as the target.
- Pick a small existing component (e.g. `NotificationBell.tsx` or `EmptyState.tsx`) and extend it with one small, real feature end to end, including hooking it into `store.ts`.

### E74. Release process and where the project is headed
**Duration:** 5 min
**Objective:** Close the developer track by pointing at the project's own planning documents so viewers can see what's coming and where to contribute next.
- Walk `docs/PLAN.md` (the original phase 1/2/3 master plan) alongside what's actually shipped now, as a "then vs. now" retrospective.
- Point at `docs/roadmap.md` and `docs/release.md` for the current release process and what's planned — code-signing being the most-referenced open item across the whole doc set.
- Mention the companion planning docs (`docs/lm-studio-plan.md`, `docs/claude-desktop-plan.md`) as background reading for why the app's shape is what it is.

---

# Suggested recording order and runtime

Record and release in track order (A → B → C → D); within each track, in
lecture number order — later episodes assume earlier ones in the same track.
Tracks B and C can be released as separate playlists once Track A is out, since
a viewer who only wants "the basics" can stop after Module 4.

| Track | Modules | Lectures | Approx. runtime |
| --- | --- | --- | --- |
| A — Beginner | 1–4 | 14 | ~80 min |
| B — Intermediate | 5–11 | 32 | ~232 min |
| C — Advanced | 12–16 | 17 | ~135 min |
| D — For developers | 17–19 | 10 | ~77 min |
| **Total** | **19** | **74** | **~524 min (≈ 8h 45m)** |

A realistic release cadence: two lectures a week gets the full series out in
under nine months; releasing a whole module at once (roughly weekly) is
friendlier to binge-watchers and keeps each module's narrative intact.

**Recommended trailer/pinned video:** a 3–4 minute cut combining E01 (what it
is), E09 (first tool call), and E58 (the Linux-in-a-browser-tab demo) — the
three moments most likely to make someone watch the rest.
