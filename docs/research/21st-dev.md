# 21st.dev research: what it is, and how HarnessStation could "have our own libraries"

Research date: 2026-08-06. Read-only research, no code changed.

## TL;DR

21st.dev is a **community registry/marketplace of copy-paste React UI components** ("npm for design engineers"), built on the shadcn/ui distribution pattern (React + Tailwind + Radix, code copied into *your* repo rather than installed as an opaque npm dependency). It also ships **Magic**, a hosted AI generation service exposed as an **MCP server**, so an editor/agent can generate or fetch a component from natural language and drop it straight into a codebase. Components are MIT-licensed and free to browse; a paid membership only raises daily copy limits and adds AI credits / premium templates.

For HarnessStation, the highest-leverage, lowest-risk move is **(c) — list 21st's Magic MCP in our curated MCP directory** (`server/mcp-directory.json`). It works with our existing stdio MCP client today, needs zero app code changes, and immediately gives any user who has an OpenAI/Anthropic-class agent connected the ability to generate/fetch React components on demand. Adopting 21st/shadcn components into our *own* UI (option a) is real polish but blocked on a stack mismatch: HarnessStation has no Tailwind — it's ~4,800 lines of hand-written CSS in `src/App.css` — so "adopt" really means "port," not copy-paste. Building our own template/design registry (option b) is the most strategic long-term option and is a natural, small extension of the community library we already run (`server/index.mjs` + `src/lib/community.ts`), but it's a multi-week feature, not a quick win.

Details and reasoning below.

---

## 1. What 21st.dev is

**Positioning:** "npm for design engineers" — a searchable, community-powered catalog of ~12,000+ React UI components, blocks, and full templates, explicitly modeled on shadcn/ui's philosophy: you don't `npm install` a component library, you **copy the source into your own repo** and own it from there. Scale claims: ~1.4M developers, ~200K MAU (per Product Hunt / press coverage — self-reported, treat as directional).

**How components are discovered, published, installed:**
- **Discovery:** browsable/searchable catalog with live previews, demo videos, tags/categories (e.g. "pricing section," "hero," "sign-in").
- **Publishing:** community-submitted. A component is `code.tsx` plus one or more `demos/` (each with `code.demo.tsx`, a preview image, optional video). Files are stored in Cloudflare R2 under `components-code/{user_id}/{component_slug}/`. Submissions go through states: `on_review` → `posted` (visible on profile) → `featured` (promoted on homepage); review is manual (reportedly the founder personally reviews for quality).
- **Install paths, three of them:**
  1. **shadcn CLI**, the "traditional" path: `npx shadcn@latest add "https://21st.dev/r/<component>"` — this is literally the shadcn registry protocol (see §4), with 21st.dev acting as a registry host.
  2. **Copy-paste an "AI-ready prompt"** into an agent (Cursor, Claude Code, v0, Lovable, etc.) that describes the component; the agent rebuilds it in your codebase.
  3. **Magic MCP** (see §3) — an agent connected to 21st's MCP server can search/generate/insert components directly, no manual copy step.

**Assumed tech stack:** React + TypeScript, Tailwind CSS, Radix UI primitives, shadcn/ui conventions (the "new-york"/"default" style system, `cn()` class-merge helper, CSS variables for theming). Framer Motion shows up in many individual components (especially animated marketing blocks) but isn't a hard registry-wide dependency — it's per-component, declared like any other npm dependency.

**Licensing/pricing:**
- Components/code: **MIT-licensed**, free to browse, preview, and use commercially without restriction.
- Free tier: unlimited browsing/search/preview, **2 free component copies/day** per signed-in user.
- Paid membership (**Builder**, ~$6–8/mo annual/quarterly without AI; **Builder + AI**, ~$15–20/mo for 500–2,000 monthly AI generation credits): unlimited copies, AI credits for generating/refining UI via Magic, access to **premium templates**.
- Premium/full templates are sold by their individual creator authors, so — unlike the MIT component snippets — pricing and license terms for a *complete template* can vary and aren't guaranteed to be MIT; treat "template" purchases as third-party creator terms, not the platform-wide MIT grant.
- Creator payouts: templates are described as authors' own products sold through the platform (implying a marketplace cut model), but exact payout mechanics weren't published in what we could access — flag as unconfirmed if it matters for any partnership discussion.

Sources: [21st.dev homepage](https://21st.dev), [GitHub — serafimcloud/21st](https://github.com/serafimcloud/21st), [Product Hunt — 21st](https://www.producthunt.com/products/21st-dev-the-npm-for-design-engineers), [21st.dev pricing](https://21st.dev/pricing), [help.21st.dev pricing](https://help.21st.dev/magic-chat/pricing).

---

## 2. Templates & designs

Beyond single components, the catalog includes:
- **"Marketing blocks"** (2,000+): animated heroes, hero sections, shader/gradient backgrounds, footers, CTA sections — bigger, opinionated compositions rather than atomic components.
- **UI components** (2,100+): buttons, cards, nav, sign-in/auth forms, pricing sections (216+ pricing-section variants alone), dialogs, etc.
- **Full templates**: "complete, production-ready starting points" — whole landing pages / dashboards assembled from multiple blocks+components, sold individually by their creator (this is the part gated behind purchase/membership rather than the flat MIT grant).

Structurally these are the same underlying unit (a component or composed set of components with demos and metadata) at increasing granularity: **component → block (multi-component section) → template (multi-block page)**. There's no separate "template file format" — a template is just a larger registry item (or bundle of registry items) with its own `registry-item.json`-equivalent metadata, consistent with the shadcn registry model in §4 (which explicitly supports a `registry:page`/`registry:block` `type` for exactly this composition).

---

## 3. Magic MCP — could HarnessStation connect it today?

**What it is:** Magic (package `@21st-dev/magic`, now folded into the unified `@21st-dev/cli` / "21st MCP") is a **thin client MCP server** — there's no local model runtime; it's stdio glue that calls 21st.dev's hosted generation API. Tools exposed (current naming; legacy Magic tool names still map through for old configs):

| Legacy tool | Current tool | Purpose |
|---|---|---|
| `21st_magic_component_builder` | `generate` | Create a new UI component from a text prompt |
| `21st_magic_component_refiner` | `generate` | Refine/iterate an existing component |
| `21st_magic_component_inspiration` | `get_inspiration` | Pull existing catalog components as reference |
| `logo_search` | `search_logo` | Fetch brand logos as JSX/TSX/SVG |

Plus newer catalog-search, paid-code-retrieval, bookmarks, and team-library tools (call `tools/list` for the live set — it's evolved past the original four).

**Setup — stdio (the form that matters for us):**
```bash
npx -y @21st-dev/magic@latest API_KEY="<your 21st.dev API key>"
```
Equivalently via env var: `TWENTY_FIRST_API_KEY` or `API_KEY_21ST`. This is the exact `{command, args, env}` shape HarnessStation's MCP client already uses.

**Setup — HTTP (their newer recommended form):**
```json
{
  "mcpServers": {
    "21st": {
      "url": "https://21st.dev/api/mcp",
      "headers": { "x-api-key": "YOUR_21ST_API_KEY" }
    }
  }
}
```

**Can HarnessStation connect it today? Yes, via stdio — with a caveat on the HTTP form.** I checked our MCP plumbing:
- `src/lib/mcp.ts` → `McpServerConfig` already has exactly the fields needed for the stdio form: `transport: "stdio" | "http"`, `command`, `args`, `env`, plus `url`/`token` for HTTP.
- `src-tauri/src/mcp.rs` (the Rust client) sends the HTTP-transport token as a **hardcoded `Authorization: Bearer {token}` header** (line ~87). 21st's HTTP endpoint wants a `x-api-key` header instead, which our client can't currently send — so the HTTP/URL form would **not** authenticate as-is.
- The **stdio form works unmodified today**: `command: "npx"`, `args: ["-y", "@21st-dev/magic@latest"]`, `env: { TWENTY_FIRST_API_KEY: "<key>" }`. No app code changes needed — this is purely a `server/mcp-directory.json` entry (matching the existing pattern of other `needsAuth: true` stdio entries like Tavily/Exa/Firecrawl in that same file).

Sources: [GitHub — 21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp), [mcp.so — 21st.dev Magic AI Agent](https://mcp.so/servers/magic-mcp), [mcp.directory — 21st.dev Magic MCP guide](https://mcp.directory/blog/21st-dev-magic-mcp-complete-guide-2026).

---

## 4. Component registry model (the reusable pattern)

This is the part worth internalizing if we build our own — 21st.dev doesn't invent a new format, it **hosts components in the shadcn registry protocol**:

- **`registry.json`** — an index: array of registry item names/urls, effectively a manifest of everything the registry serves.
- **`registry-item.json`** (per component) — the actual unit. Key fields:
  - `name`, `title`, `description`, `author`
  - `type`: `registry:block | registry:component | registry:ui | registry:hook | registry:lib | registry:page | registry:file | registry:font | registry:base | registry:style | registry:theme | registry:item` — this is how "atomic component" vs "full page/template" is expressed in the *same* schema, just a different `type`.
  - `dependencies` / `devDependencies` — plain npm packages the component needs (e.g. `framer-motion`).
  - `registryDependencies` — references to *other registry items* it composes (own registry, another namespaced registry, a GitHub URL, or a raw file path) — this is how a "block" declares the smaller components it's built from, and how a "template" declares the blocks it's built from.
  - `files[]` — `{ path, type, target }`; `target` supports placeholder dirs (`@components/`, `@ui/`, `@lib/`, `@hooks/`) so the CLI knows where to drop each file in *your* project structure.
  - `tailwind` (deprecated) / `cssVars` / `css` — theme tokens and Tailwind config merges (light/dark aware).
  - `envVars`, `docs`, `categories`, `meta` — installation notes and free-form metadata.
- **Install command:** `npx shadcn@latest add <registry-item-url-or-name>` — the CLI fetches the JSON, resolves `registryDependencies` recursively, installs npm `dependencies`, writes `files` to their `target` paths, and merges `cssVars`/Tailwind config into the consuming project.

21st.dev's own stack running this: **Next.js 14 frontend, Supabase (metadata/DB), Clerk (auth), Cloudflare R2 (component file storage), Amplitude (analytics)**, MIT-licensed, repo at [serafimcloud/21st](https://github.com/serafimcloud/21st).

**Why this matters for us:** if HarnessStation ever wants an "install this design into my app" experience — even just for its *own* in-app agent-built UIs — the shadcn registry shape (`registryDependencies` for composition, `files[]` with `target` placeholders, `type` spanning component→block→page) is a proven, minimal schema we could either (a) literally point our own registry items at, so `npx shadcn add <our-url>` works for external users of our exported code, or (b) borrow the shape for our own community-library payload without adopting the CLI.

Sources: [shadcn — Registry overview](https://ui.shadcn.com/docs/registry), [shadcn — registry-item.json reference](https://ui.shadcn.com/docs/registry/registry-item-json).

---

## 5. Where HarnessStation stands today (context for the recommendations)

- **UI stack:** plain React 19 + hand-authored CSS. `src/App.css` is **4,790 lines**; there is **no Tailwind, no shadcn, no Radix, no Framer Motion** anywhere in `package.json` or the source tree (verified: grep for "tailwind" across the repo returns zero hits). ~40 hand-built view components live in `src/components/` (e.g. `AgentsView.tsx`, `SkillsView.tsx`, `Dialog.tsx`, `icons.tsx`).
- **MCP support:** already solid — stdio and HTTP transports, a curated directory (`server/mcp-directory.json`, 30+ entries with `name/category/description/transport/command|url/needsAuth`) rendered in-app via `McpView.tsx`. Adding a new curated server is a pure data change to that JSON file.
- **Community library:** already built and running (`server/index.mjs` + `src/lib/community.ts`). It's a real little marketplace: anonymous publish (author name only, no accounts), IP-hashed likes, download counts, tag cloud, trending/recommended/downloaded/newest sorts, report-driven auto-hide + admin moderation endpoints (`/api/admin/library`), all persisted to a flat `library.json` on the gateway box. Kinds today: `skill | agent | workflow | schedule`, each with a `cleanXForPublish()` sanitizer that strips machine-local ids before sharing and a `communityImport()` that re-hydrates into the local store. This is architecturally *general* — the type union, the publish/list/like/download/report endpoints, and the payload-is-just-a-string design don't care what "kind" of thing is being shared.

---

## 6. Recommendations

### (a) Adopt 21st.dev/shadcn components to polish HarnessStation's own React UI

**What it'd take:** Not copy-paste-and-go, because there's a stack mismatch. Real path: add Tailwind + a `cn()` helper + Radix primitives to the Vite/Tauri build, decide how it coexists with 4,790 lines of existing hand-written CSS (rip-and-replace per view vs. a slow creeping migration), then pull individual components (buttons, dialogs, command palettes, forms) either via the shadcn CLI (`npx shadcn add <url>`) or an agent using Magic MCP, and hand-adapt each to our design language and dark theme.

**Pros:** Faster path to visually polished, accessible (Radix), animated UI for specific pain points — e.g. `Dialog.tsx`, `CommandPalette.tsx`, `ContextMenu.tsx` are exactly the kind of component 21st.dev has dozens of well-tested variants of. MIT license, no cost, no vendor lock-in (code is copied in, not depended on).
**Cons:** Introduces a second styling system to maintain alongside 4,790 lines of existing CSS; Tailwind's utility-class approach is a genuine paradigm shift for whoever maintains this codebase; risk of a half-migrated, visually inconsistent app if done piecemeal; bundle-size/build-config churn in a Tauri app that currently has none of this.
**Effort:** Medium-to-large, and it's a standing tax (every future component either fits the old system or the new one). Best treated as a deliberate, scoped redesign project (e.g. "migrate to Tailwind" as its own initiative), not an incremental drop-in.

### (b) Build our own component/template registry ("designs" library)

**What it'd take:** Extend the existing community library rather than build new infrastructure:
- `server/index.mjs`: add `"design"` (or `"template"`) to `KINDS`; the publish/list/like/download/report/moderation routes are already type-agnostic (`type` is just a string field, `payloadValid()` just needs a branch), so this is a small, additive diff, not a rewrite.
- `src/lib/community.ts`: extend `CommunityKind`, add a `cleanDesignForPublish()` (probably a no-op or strips nothing — a component payload has no "machine-local ids" the way an agent does) and a `communityImport()` branch. The payload could be as simple as `{ code: string, dependencies: string[], preview?: string }`, or go further and adopt the shadcn `registry-item.json` shape from §4 directly (`files[]`, `registryDependencies`, `cssVars`) — reusing that schema means anything published could *also* be installed via the standard `npx shadcn add` CLI outside HarnessStation, for free interoperability with the wider ecosystem.
- New UI surface: a "Designs" tab in `CommunityView.tsx` alongside Skills/Agents/Workflows/Schedules, plus a way to *use* an imported design — this is the open question, since HarnessStation doesn't currently render arbitrary user-supplied React/JSX inside the app (that's a sandboxing/eval problem, not a registry problem). Realistically the "import" action for v1 would be "copy this snippet to clipboard / save as a file the user drops into their own project," not "render live inside HarnessStation" — the latter needs a code-execution story we don't have.
**Pros:** Directly on-brand — "have our own libraries" becomes literally true, reuses proven infra (moderation, likes, trending, anonymous publish) instead of building new, and differentiates us (a *local-first agent app* with a community design library is a genuinely different pitch than 21st.dev's web-first registry). Full control over quality bar and curation.
**Cons:** Cold-start problem — a registry is only as good as its catalog, and we'd start at zero against 21st's ~12,000 items; "import" is the hard, open question (see above) unless scoped down to snippet/file export; ongoing moderation/quality burden on top of what we already carry for skills/agents/workflows.
**Effort:** Medium for the backend/data-model slice (a few days, closely mirrors existing code); larger and open-ended for a genuinely useful "install into my project" experience — that's the part that needs its own design decision before estimating.

### (c) Connect 21st.dev's Magic MCP as a first-class option in our MCP directory

**What it'd take:** Add one entry to `server/mcp-directory.json`:
```json
{
  "name": "21st.dev Magic",
  "category": "Dev",
  "description": "AI-generated React/Tailwind UI components, on demand.",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@21st-dev/magic@latest"],
  "needsAuth": true
}
```
(env var for the API key — `TWENTY_FIRST_API_KEY` — entered wherever the app currently prompts for stdio-server secrets, same as Tavily/Exa/Firecrawl today). No changes to `McpView.tsx`, `mcp.ts`, or the Rust client needed — this rides the existing stdio path exactly.
**Pros:** Essentially free — one JSON entry, ships in the next release. Gives any HarnessStation user with a capable agent instant access to a 12,000-component catalog and AI generation, which is *more* library than we could build ourselves for a long time. Zero maintenance burden (21st.dev hosts and runs the generation backend).
**Cons:** Requires the user to have (or pay for) a 21st.dev API key/account — it's someone else's product surfaced inside ours, not "our own library" in the sense the prompt is asking about. Generated components still land as raw React/Tailwind code the user has to reconcile with our non-Tailwind CSS if they're building *inside* HarnessStation's own UI (irrelevant if they're using it to build their own separate app, which is the more likely use case for an agent-harness user). The HTTP transport variant is currently blocked by our Rust client's hardcoded `Authorization: Bearer` header (§3) — stick to the stdio form.
**Effort:** Trivial — under an hour, data-only change.

### Which is highest-leverage?

For "ship something real, soon": **(c)**, unambiguously — it's a one-entry JSON change that plugs a 12,000-component, AI-backed registry into every user's agent today, and it validates whether users actually want component-generation workflows inside HarnessStation before we invest further.

For "have our own libraries" in the sense the prompt actually means — a HarnessStation-branded, community-driven designs library — **(b)** is the right long-term target, specifically because it's not a new system: it's the *same* publish/moderate/like/download machinery we already run for skills/agents/workflows/schedules, extended by one more `kind`. That reuse is the whole reason this is more tractable than it sounds. The open design question to resolve before scoping it further is **what "import" means for a design** (copy-to-clipboard/file export vs. live in-app rendering) — that decision, not the backend plumbing, determines whether this is a one-week feature or a multi-month one.

**(a)** is the one to defer: it's a real, valuable investment (our hand-rolled dialogs/menus/forms would benefit from Radix's accessibility and 21st's polish) but it's a standing architectural commitment (adopting Tailwind) that deserves its own decision and shouldn't be backed into as a side effect of "let's grab a few nice components."

**Suggested sequencing:** ship (c) first (trivial, immediate value, low risk) → use it as a live signal of whether users want design/component workflows at all → if yes, scope (b) properly (starting with the narrower "copy/export" import model) → treat (a) as a separate, deliberate redesign decision independent of the other two.

---

## Sources

- [21st.dev](https://21st.dev) — homepage/product
- [21st.dev pricing](https://21st.dev/pricing) / [help.21st.dev pricing](https://help.21st.dev/magic-chat/pricing)
- [GitHub — serafimcloud/21st](https://github.com/serafimcloud/21st) — open-source registry app (Next.js/Supabase/Clerk/R2, MIT)
- [GitHub — 21st-dev/magic-mcp](https://github.com/21st-dev/magic-mcp) — Magic/21st MCP server
- [mcp.so — 21st.dev Magic AI Agent](https://mcp.so/servers/magic-mcp)
- [mcp.directory — 21st.dev Magic MCP: Complete Guide (2026)](https://mcp.directory/blog/21st-dev-magic-mcp-complete-guide-2026)
- [Awesome MCP Servers — 21st.dev Magic](https://mcpservers.org/en/servers/21st-dev/magic-mcp)
- [shadcn — Registry overview](https://ui.shadcn.com/docs/registry)
- [shadcn — registry-item.json reference](https://ui.shadcn.com/docs/registry/registry-item-json)
- [Product Hunt — 21st](https://www.producthunt.com/products/21st-dev-the-npm-for-design-engineers)
- [Claude's Corner — 21st.dev goes all-in on agent infrastructure](https://www.startuphub.ai/ai-news/claudes-corner/2026/claudes-corner-21st-dev-yc-w2026)

## HarnessStation files referenced

- `C:\Users\Najma-LP\Desktop\HarnessX\server\index.mjs` — gateway; community library routes (`/api/library*`), MCP directory route
- `C:\Users\Najma-LP\Desktop\HarnessX\server\mcp-directory.json` — curated MCP server list (where a 21st.dev Magic entry would go)
- `C:\Users\Najma-LP\Desktop\HarnessX\src\lib\community.ts` — community library client (kinds, publish/import, sanitizers)
- `C:\Users\Najma-LP\Desktop\HarnessX\src\lib\mcp.ts` — `McpServerConfig`, MCP connect/request client
- `C:\Users\Najma-LP\Desktop\HarnessX\src-tauri\src\mcp.rs` — Rust MCP client; HTTP transport hardcodes `Authorization: Bearer` (no arbitrary headers)
- `C:\Users\Najma-LP\Desktop\HarnessX\src\App.css` — 4,790-line hand-written stylesheet; no Tailwind anywhere in the repo
- `C:\Users\Najma-LP\Desktop\HarnessX\src\components\` — ~40 existing hand-built view components (candidates for (a) if pursued)
- `C:\Users\Najma-LP\Desktop\HarnessX\package.json` — confirms current dependency set (React 19, Zustand, no Tailwind/shadcn/Radix/Framer Motion)
