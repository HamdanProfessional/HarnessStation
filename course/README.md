# HarnessStation video course — production kit

Record-ready assets for the opening lectures of the course in
[`../docs/COURSE_CURRICULUM.md`](../docs/COURSE_CURRICULUM.md):

| Ep. | Title | Deck | ~VO runtime |
|-----|-------|------|-------------|
| E01 | What HarnessStation actually is | `E01-what-is-harnessstation.html` | 1m 15s |
| E02 | Installing on Windows | `E02-install-windows.html` | 1m 21s |
| E03 | Installing on Linux | `E03-install-linux.html` | 1m 08s |
| E04 | Building from source | `E04-build-from-source.html` | 1m 05s |
| E05 | Where your data lives | `E05-data-location.html` | 1m 05s |
| E06 | Connecting a free local model (Ollama) | `E06-connect-ollama.html` | 1m 04s |
| E07 | Connecting a cloud provider | `E07-connect-cloud.html` | 0m 56s |
| E08 | Sending your first message | `E08-first-message.html` | 0m 41s |
| E09 | Giving it a tool (it becomes an agent) | `E09-first-tool.html` | 1m 06s |
| E10 | A tour of the sidebar | `E10-sidebar-tour.html` | 1m 00s |
| E11 | The agent loop | `E11-agent-loop.html` | 1m 13s |
| E12 | Local vs cloud, exactly | `E12-local-cloud-split.html` | 1m 01s |
| E13 | Getting better results | `E13-prompting-patterns.html` | 0m 58s |
| E14 | Working with a codebase | `E14-codebase-end-to-end.html` | 1m 13s |

| E15 | Starting a call | `E15-starting-a-call.html` | 1m 03s |
| E16 | Picking a voice (engines) | `E16-voice-engines.html` | 0m 58s |
| E17 | Barge-in &amp; delivery | `E17-barge-in-delivery.html` | 0m 59s |
| E18 | 3D avatars (VRM / MMD) | `E18-3d-avatars.html` | 1m 07s |

**Track A — Beginner is complete (E01–E14):** install → first model → first
tool → mental model → a full codebase use case.

| E19 | Connecting your first MCP server | `E19-first-mcp-server.html` | 1m 05s |
| E20 | Progressive disclosure | `E20-progressive-disclosure.html` | 0m 58s |
| E21 | MCP troubleshooting | `E21-mcp-troubleshooting.html` | 0m 43s |
| E22 | The built-in tool groups | `E22-builtin-tool-groups.html` | 0m 59s |
| E23 | Writing your own tool (JS) | `E23-write-js-tool.html` | 0m 48s |
| E24 | Writing your own tool (Python) | `E24-write-python-tool.html` | 0m 46s |
| E25 | Auto-enabling &amp; reading tool cards | `E25-auto-enable-read-cards.html` | 0m 58s |

**Track B — Intermediate is in progress.** Done: Module 5 (Voice, E15–E18),
Module 6 (MCP, E19–E21), Module 7 (Tools, E22–E25). Module 8 (Projects, from
E26) continues from the curriculum.

Each lecture is an **HTML slideshow** you show in Chrome and screen-record,
intercut with live screen capture of the app / installer at the marked cue
points. You record **silent**, then add **voice + subtitles** afterward — the
subtitle and script files here are already timed to the slides.

## The workflow

1. **Open the deck** — double-click the `E0x-*.html` file (or drag it into
   Chrome). Press **F** for fullscreen. Record Chrome at **1080p**; the canvas is
   a fixed 1920×1080 stage, so it stays pixel-crisp.
2. **Record the screen, no microphone.** Advance the slides yourself, or press
   **A** to auto-advance at each slide's scripted pace (`data-seconds`) so the
   silent take already matches the voiceover length.
3. **Cut to the app at the cue points.** Each cue (a "▶ SWITCH TO…" note) is in
   the storyboard and, on screen, visible only in presenter mode (**N**) so it
   never lands in the recording. Record those app/installer moments separately
   and drop them over the matching slide.
4. **Generate the voice** from `scripts/E0x-narration.txt` (see below), and lay
   it on the timeline.
5. **Add subtitles** — import `subtitles/E0x.vtt` (or `.srt`). It's already timed
   to the slides, so with the auto-advance take it lines up out of the box; nudge
   if you improvised.

## Deck controls (while recording)

| Key | Action |
|-----|--------|
| → / Space / PageDown | Next slide |
| ← / PageUp | Previous slide |
| **A** | Auto-advance at the scripted pace (times the silent take) |
| **C** | Toggle burned-in captions (the narration line) |
| **N** | Presenter mode — notes + director cues, off-screen (don't record with this on) |
| **F** | Fullscreen |
| Home / End | First / last slide |
| Click | Right two-thirds = next, left third = back |

## Adding the voice

The narration in `scripts/E0x-narration.txt` is plain text split by slide. Two
easy ways to voice it:

- **Use HarnessStation itself.** In a chat with a media/speech model configured
  (Settings → Media models), the `generate_speech` tool turns the script into
  audio; or use the built-in neural voice **Kokoro**. Fully local, no cloud.
- **A cloud TTS** (ElevenLabs, OpenAI `tts-1`, Play.ht…). Paste the script,
  export per-slide or per-episode clips.

Render per-slide clips if you want the tightest sync, or one clip per episode and
trim to the caption timings.

## Editing the decks

Slide content, timing and cues all live in the deck HTML. Each `<section
class="slide">` can carry:

- `data-narration` — the voiceover line (feeds the captions, script and `.vtt`)
- `data-seconds` — how long the VO on that slide runs (paces autoplay + subtitle
  timing)
- `data-cue` — an on-screen action / cut-to-app note (presenter-only)

After any edit, regenerate the derived files so nothing drifts:

```bash
node course/assets/build-subtitles.mjs
```

That rewrites `subtitles/`, `scripts/` and `storyboards/` from the decks.

## What's generated vs. authored

- **Authored:** the three `E0x-*.html` decks, `assets/deck.css`, `assets/deck.js`.
- **Generated** (don't edit by hand — edit the deck and re-run the script):
  `subtitles/*.vtt`, `subtitles/*.srt`, `scripts/*-narration.txt`,
  `storyboards/*.md`.

## Recording checklist

- [ ] Chrome at 1080p, deck fullscreen (**F**), presenter mode **off**
- [ ] Screen recorder set to 1080p / 30–60fps, **mic muted**
- [ ] App pre-configured for the cut-ins (a provider added, a model chosen)
- [ ] For E02: a real download so the SmartScreen box appears on camera
- [ ] For E03: a Linux box/VM to show AppImage + the WebKit fix live
- [ ] After recording: voice from the script, then drop the matching `.vtt`
