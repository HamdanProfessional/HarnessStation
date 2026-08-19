# Frozen — what this project is deliberately not doing

*Written 2026-08-17.*

A roadmap says what you'll build. This says what you won't, which for a
single-maintainer project with 127 frontend files matters more. Anything listed
here is **feature-complete at its current level and takes no further investment**
until the conditions for unfreezing are met.

Frozen does not mean deleted, deprecated or broken. Everything here works and
keeps working; it stops *growing*. If something frozen breaks because an upstream
moved, fix it — that's maintenance, not investment.

The point is to stop these consuming attention. A thing on this list is not a
decision to be re-litigated each time it's touched; it has already been decided.

---

## Why freeze anything

Three constraints, all real:

1. **One maintainer.** Every feature is a surface that breaks when a dependency,
   a provider API or an OS moves. The surface is already larger than one person
   can actively develop.
2. **The bundle.** The entry chunk is ~6 MB (2.1 MB gzipped). Now that the
   browser build is the front door, that number is a conversion cost paid by
   every first-time visitor, not just a build-log warning.
3. **The sentence.** You cannot say what a product is in one line while it does
   everything. Freezing the long tail is what makes the short pitch true.

---

## Frozen

### 3D avatars (VRM / MMD)

**State:** works — VRM and MMD import, voice-state animation, mic-level response.

**Frozen:** `roadmap.md` §2.1 (viseme lip-sync via `AnalyserNode`, mouse/camera
head tracking) is **not being done**.

**Why:** it carries `three` (734 kB) + `three-vrm` (150 kB) + a vendored
`MMDLoader`, which is the single largest dependency group serving the smallest
audience. It's also the feature most likely to make a serious evaluator — the
kind who'd pay for an org licence — stop taking the product seriously.

**Honest counter-argument:** it is probably the best social-media hook in the
app. A talking 3D character is far more shareable than a price table. That's why
this is frozen at "works" rather than removed.

**Unfreeze when:** avatars are demonstrably driving adoption, or the whole
avatar stack can move behind a lazy boundary that costs a non-user nothing.

### The 74-lecture course

**State:** 74 HTML episodes, 74 storyboards, 74 narration scripts, 148 subtitle
files under `course/`.

**Frozen:** no new episodes, no re-cuts to match UI changes.

**Why:** writing 74 lectures against a 0.3.0 app with documented rough edges is
inverted — the product will move and invalidate them faster than they can be
maintained. `docs-site/` at 40 pages is the right amount of prose to keep
current. The course is a *product*, and products need their own release cycle.

**Unfreeze when:** the app has a stable release the course can be pinned to, or
the course is split out and sold/published on its own schedule.

### Media generation

**State:** image, audio, video and 3D presets in `lib/media.ts`, wired to
Replicate / OpenAI / local A1111 endpoints.

**Frozen:** no new engines or modalities in-tree.

**Why:** these are thin wrappers over third-party HTTP APIs — precisely the shape
that should be an MCP server rather than built-in code. In-tree, every provider
change is an app release; as a server, it versions and fails independently.

**Unfreeze when:** migrated to MCP, at which point it isn't app surface at all.

### React artifacts in the canvas

**State:** the canvas renders HTML, SVG and Mermaid. JSX/TSX falls back to a code
block.

**Frozen:** `roadmap.md` §2.2 is **not being done**.

**Why:** it needs `@babel/standalone` (~2.7 MB) plus React UMD builds inlined
into the sandbox. The roadmap already flags this as "worth deciding
deliberately". This is that decision: no. Lazy-loading limits the startup cost
but not the maintenance cost, and the feature is narrow.

**Unfreeze when:** users are actually asking for it.

### `packages/ui-kit`

**State:** a 606-line component library that **nothing in the app imports**, and
a third divergent copy of the same components (`src/components/`,
`.design-sync/previews/`, `packages/ui-kit/src/`) — every `Dialog.tsx` differs.

**Frozen:** no further design-system work until the duplication is resolved one
way or the other.

**Why:** three definitions of what a Dialog is will produce a bug. This is the
one item on this list that is a live liability rather than merely a cost.

**Unfreeze when:** decided — either the app imports the kit and the other copies
go, or the kit is deleted. Note the current branch is `design-sync-ui-kit`, so
this may already be in progress; if so, finish it or revert it, don't leave it.

---

## Not frozen — where the investment goes

For contrast, so this document isn't only subtraction. These are the things that
earn work:

| Area | Why it earns investment |
| --- | --- |
| **The browser build** (`web/`) | The only thing in this category that runs a real Linux kernel, CPython and a persistent filesystem in a tab. It is both the strongest claim and the zero-friction trial. Now the front door. |
| **Device mesh** (`src-tauri/src/mesh.rs`) | Rare, and the request bodies are still plaintext — a stated security hole in a product whose whole pitch is privacy. Fixing it is not optional. |
| **Value / price intelligence** (`lib/pricing/`) | Nobody else in the category has it, it needs no key or server, and it depends on upstream schemas that will move — hence the live canary test. |
| **Core loop** — chat, tools, MCP, memory | The thing everything else hangs off. |
| **Bundle size** | Directly a conversion cost now that a tab is the first impression. |
| **Making features into MCP servers** | The structural fix for all of the above: a small core plus independently-versioned satellites is the only shape one person can sustain. |

---

## Reviewing this

Revisit when a release ships or the positioning changes — not when a frozen item
looks briefly interesting. That impulse is exactly what this document exists to
absorb.
