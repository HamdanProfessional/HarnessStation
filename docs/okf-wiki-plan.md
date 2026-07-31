# OKF Wiki — Feature Plan

> A navigable, model-maintained knowledge base (Karpathy's "LLM Wiki" → Google's Open Knowledge
> Format). A folder of linked markdown files the model reads like a codebase — the complement to
> our embedding-based RAG. Planned 2026-07-20.

## Goal
Add a third knowledge mode alongside **RAG** (embed + retrieve) and **agent memory** (facts):
an **OKF bundle** = a folder of plain markdown files that the model **navigates** (reads the index,
opens the one file it needs) and **maintains** (creates/links/updates files + regenerates the
index & changelog). No embeddings, no DB — just text, diffable and offline-readable.

## Why it's cheap for us
We already have the runtime: a per-chat **working directory** + the built-in tools **`list_folder`,
`read_file`, `grep_files`, `edit_file`, `write_file`**. Those *are* how a model navigates and edits
an OKF bundle. This feature is mostly (a) a way to register/attach a wiki folder, (b) index/changelog
generation, and (c) a guided "maintain" flow — not new inference infra.

## OKF bundle layout (on disk)
A wiki is any folder the user points at. We follow the spec loosely:
```
<wiki>/
  INDEX.md          # table of contents: one line per file (path — type — 1-line summary)
  CHANGELOG.md      # append-only log of updates (date — file — what changed)
  <concept>.md      # one file = one concept; front-matter `type:` field; links via [text](other.md)
  <area>/<concept>.md
```
Rules (forgiving, per OKF): every file *should* declare `type:` in front-matter; unknown fields,
broken links, and unparseable files are tolerated, never fatal.

## Data model (types.ts)
```ts
export interface Wiki {
  id: string;
  name: string;
  path: string;        // absolute folder path
  providerId: string;  // model used for maintenance (build index, summarize, edit)
  model: string;
}
```
`Chat` gains `wikiId?: string` (attach a wiki to a chat, like `knowledgeBaseId`/`workingDir`).

## Storage
- `~/.harnessx/wiki/*.json` — one `Wiki` per file (reuse the generic `listJson/saveJson/removeJson`
  helpers already in storage.ts): `listWikis / saveWiki / deleteWiki`.
- The wiki *content* lives in the user's chosen folder, read/written via the existing Rust
  `fs_read/fs_write/fs_list` commands (arbitrary paths, already built for the working-directory tools).

## Read path (using a wiki in chat)
When a chat has `wikiId` set:
1. Load `INDEX.md` (or auto-generate it if missing) and inject it into the system prompt as
   "Knowledge wiki table of contents — open the relevant file(s) with read_file before answering."
2. Auto-enable the read tools (`list_folder`, `read_file`, `grep_files`) scoped to the wiki path
   (set the chat's working dir to the wiki folder, or pass the path into the tool ctx).
3. The model reads the TOC → opens only the file(s) it needs → answers. (The "skip the other 9,000"
   behavior; no context-rot from dumping everything.)

## Maintain path (the part Google left out)
A **"Update wiki from material"** action (in the Wiki view, or a chat command):
1. Input: pasted text, a file, or "summarize this conversation".
2. Run a maintenance **agent loop** (reuse `runAgent`/`chatOnce`) with `edit_file`/`write_file`/
   `read_file` scoped to the wiki, instructed to:
   - decide which concept file(s) the material belongs to (create or update),
   - keep files atomic (one concept each) and cross-link related files,
   - update front-matter `type:` fields.
3. After edits, **regenerate `INDEX.md`** (walk the folder, read each file's title + `type` +
   first line → TOC) and **append to `CHANGELOG.md`** (date + files touched + summary).
4. Validate: ensure each `.md` parses, warn on links pointing to missing files.

## UI
- **Knowledge view** gets a second section "Wikis (OKF)" (or a tab): list wikis, "New wiki"
  (name + folder picker + maintenance model), "Update from material", "Rebuild index", "Open folder".
- **Chat config panel**: a "Wiki" selector next to the existing "Knowledge base" selector.
- Show the wiki's file count + last-updated (from CHANGELOG) on its card.

## Addressing the video's two caveats
- **Staleness** ("a field is not a process"): we *make* it a process — index + changelog regenerate
  on every maintenance run, and the card surfaces last-updated so stale wikis are visible. Optional:
  a scheduled "refresh/reconcile" job (reuse Schedules) that re-summarizes changed files.
- **Messy markdown at scale**: constrain the maintainer with a strict file template + post-edit
  validation (parse check, link check, front-matter check); reject/repair malformed writes rather
  than trusting the model blindly.

## Implementation steps
1. Types: `Wiki`, `Chat.wikiId`. Storage: `listWikis/saveWiki/deleteWiki`. Store state + CRUD.
2. `lib/wiki.ts`: `readIndex(path)`, `buildIndex(path)` (walk + summarize), `appendChangelog(path, …)`,
   `updateWikiFromMaterial(wiki, material, onEvent)` (the maintenance agent loop).
3. Read-path wiring in the completion loop (inject INDEX, scope tools to the wiki folder).
4. `WikiView` component + Knowledge/Automation nav entry; chat-panel wiki selector.
5. Validation helpers (parse/link/front-matter checks) + "Rebuild index" action.
6. (Optional) Schedules integration for periodic reconcile.

## Out of scope (v1)
- A full graph visualizer of file links (nice later).
- Multi-user/shared-folder conflict handling (the video flags this as the hard problem; single-owner
  folders only for v1).
- Automatic ingestion from external sources (web/Drive) — user brings the material for now.

## Effort
~M (1–2 days). Most of it is UI + the maintenance loop + index/changelog generation; the read/edit
primitives already exist as built-in tools and Rust fs commands.
