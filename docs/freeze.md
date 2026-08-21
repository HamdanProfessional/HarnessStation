# Frozen — what this project is deliberately not doing

*Written 2026-08-17. Bundle figures corrected 2026-08-20 — see constraint 2;
the correction affects the avatars entry.*

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

Two constraints, both real — and one that turned out not to be:

1. **One maintainer.** Every feature is a surface that breaks when a dependency,
   a provider API or an OS moves. The surface is already larger than one person
   can actively develop.
2. **~~The bundle.~~ Corrected 2026-08-20 — this was measured wrong, and it was
   the weakest of the three anyway.**

   The original claim was "the entry chunk is ~6 MB (2.1 MB gzipped)... a
   conversion cost paid by every first-time visitor". **The entry chunk is
   774 kB (241 kB gzipped).**

   The 6 MB chunk is `@mlc-ai/web-llm`, which Vite happened to name
   `index-*.js` in the build log — that is where the misreading came from. It is
   lazy: `dist/index.html` neither loads nor preloads it, and it is fetched only
   if someone actually runs a model in the tab. Verified by forcing it into an
   explicitly named chunk, which produced a byte-identical file with the same
   content hash.

   Bundle size still deserves attention now that a tab is the first impression.
   But at 241 kB gzipped it is not a number that justifies freezing a feature,
   and it should not be cited as one.
3. **The sentence.** You cannot say what a product is in one line while it does
   everything. Freezing the long tail is what makes the short pitch true.

Constraints 1 and 3 are untouched by the correction, and between them they still
justify most of this document. Only the avatars entry leaned on constraint 2.

---

## Frozen

### 3D avatars (VRM / MMD)

**State:** works — VRM and MMD import, voice-state animation, mic-level response.

**Frozen:** `roadmap.md` §2.1 (viseme lip-sync via `AnalyserNode`, mouse/camera
head tracking) is **not being done**.

**Why:** it is the feature most likely to make a serious evaluator — the kind
who'd pay for an org licence — stop taking the product seriously. That reason is
about positioning, it is independent of anything technical, and it stands.

**~~Why (bundle cost)~~ — withdrawn 2026-08-20.** The original entry also said
`three` (734 kB) + `three-vrm` (150 kB) + the vendored `MMDLoader` were "the
single largest dependency group serving the smallest audience". They are still
the largest group, but they cost a non-user **nothing**: `three` builds as its
own chunk and `dist/index.html` carries no modulepreload for it, so it is
fetched only when an avatar is actually opened. See constraint 2.

**Honest counter-argument:** it is probably the best social-media hook in the
app. A talking 3D character is far more shareable than a price table. That's why
this is frozen at "works" rather than removed.

**Unfreeze when:** avatars are demonstrably driving adoption.

> The second condition here used to read "or the whole avatar stack can move
> behind a lazy boundary that costs a non-user nothing". **That condition was
> already met when it was written** — the lazy boundary exists. It has been
> removed rather than marked satisfied, because leaving it would mean this entry
> unfreezes on a technicality rather than on the positioning judgement that is
> the actual reason to keep it frozen.
>
> Net effect of the correction: the freeze still holds, but on one reason
> instead of two. If the positioning argument ever stops convincing, there is
> nothing else holding it.

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
go, or the kit is deleted.

**Update 2026-08-20.** `design-sync-ui-kit` is merged to `main`. Re-checked, and
the entry above is still accurate on the part that matters: **nothing imports the
kit**, and the three `Dialog.tsx` copies remain at 81 / 103 / 65 lines. The
decision this entry asks for has not been made.

What did change: the **tokens** are verifiably in sync. All 24 custom properties
in `packages/ui-kit/styles.css` match `src/App.css` exactly — same names, same
values, same theme and accent blocks — and `tests/designInvariants.test.ts` now
asserts it, so an edit to one without the other fails a normal `npm test`.

That closes the *silent* half of the liability. `.design-sync/NOTES.md` warned the
tokens "can drift", and because nothing imports the kit, drift would have
produced no type error and no build failure — the design canvas would simply have
stopped showing what the app looks like. It can't now.

The *component* duplication is untouched and is still the live risk: a token
mismatch now fails a test, but three different ideas of what a Dialog is still
won't. That needs the decision, not another guard.

**Decision 2026-08-21 — keep the kit; it is a mirror, not a candidate.** The
entry above framed this as "adopt it or delete it". Both halves were wrong,
because the premise ("nothing imports it") measured the wrong thing.

*Delete* is off the table: `.design-sync/config.json` pins a live
`projectId`, and `.design-sync/NOTES.md` records that the converter bundles
straight from `packages/ui-kit/src/index.ts`. The kit is not an orphaned copy
— it is the build input for the design canvas, along with the bundled Inter
subset, the pinned Playwright build, and the 27 curated icon exclusions. The
app not importing it is the *point*, not the defect.

*Adopt* is also off the table, and cheaply demonstrated: `src/lib/views.tsx`
imports `IconFolder`, which the kit's `icons.tsx` does not export, so the
first line of adoption fails to build. The kit's `Markdown` drops Mermaid;
its `Dialog`, `ContextMenu` and `Toast` take props where ours read the
`lib/dialog` and `lib/toast` stores. Those are deliberate — the canvas has no
Zustand — and undoing them would mean rewriting working app code to suit a
preview target.

So the divergence is a *feature boundary*, and the standing question was
malformed. What was actually missing is a statement of which way facts flow:
**`src/components/` is the source of truth; the kit mirrors it, decoupled
where the canvas requires it.** `tests/designInvariants.test.ts` now pins the
two components that have not diverged at all (`EmptyState`, `Loading`)
alongside the 24 tokens. The rest are intentionally different, and that is
recorded here rather than guarded.

**Unfrozen.** Design-system work can proceed; mirror token and primitive
changes into the kit, and the tests will say so if you forget.


---

## Not frozen — where the investment goes

For contrast, so this document isn't only subtraction. These are the things that
earn work:

| Area | Why it earns investment |
| --- | --- |
| **The browser build** (`web/`) | The only thing in this category that runs a real Linux kernel, CPython and a persistent filesystem in a tab. It is both the strongest claim and the zero-friction trial. Now the front door. |
| **Device mesh** (`src-tauri/src/mesh.rs`) | Rare, and the thing nothing else in the category has. The plaintext-bodies hole called out here is **fixed** (2026-08-20): bodies are sealed with ChaCha20-Poly1305 under a per-connection key. What remains is forward secrecy and host authentication — real, but no longer the open hole. |
| **Value / price intelligence** (`lib/pricing/`) | Nobody else in the category has it, it needs no key or server, and it depends on upstream schemas that will move — hence the live canary test. |
| **Core loop** — chat, tools, MCP, memory | The thing everything else hangs off. |
| **Bundle size** | Worth watching now that a tab is the first impression — but the entry is 241 kB gzipped, not the 6 MB previously claimed, so this is maintenance rather than a fire. Keep the heavy deps (`web-llm`, `three`, `kokoro`, `mermaid`) behind the lazy boundaries they are already behind. |
| **Making features into MCP servers** | The structural fix for all of the above: a small core plus independently-versioned satellites is the only shape one person can sustain. |

---

## Reviewing this

Revisit when a release ships or the positioning changes — not when a frozen item
looks briefly interesting. That impulse is exactly what this document exists to
absorb.
