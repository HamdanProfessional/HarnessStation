---
title: Community library
description: Publish and import skills, agents, workflows, schedules and templates made by other people.
---

# Community library

The community library is a public, account-free marketplace built into the app
for user-made **skills, agents, workflows, schedules and templates**. Import what
others have made, or publish your own — all free.

Open it from the sidebar: **Library › Community**.

## Browsing

- **Filter by type** — All, Skills, Agents, Workflows, Schedules, Templates.
- **Sort** — Trending, Recommended, Most downloaded, or Newest.
- **Search** across names, descriptions, authors and tags, and filter by tag.
- **Like** an item (❤). Likes are anonymous, keyed to a hashed IP so one visitor
  counts once — no account needed.

## Importing

Hit **Import** on any card. The item is added to your local collection, with
machine-specific bits cleaned up so it works on your setup:

- **Agents** — the provider and model are blanked (they use your current ones);
  references to the author's own workflows, sub-agents and knowledge bases are
  dropped, since they can't resolve on your machine. Built-in tool ids travel
  fine.
- **Workflows** — imported with a fresh id.
- **Schedules** — imported **disabled**; pick your own target agent/workflow and
  model, then enable it.
- **Skills** — the `SKILL.md` is saved under a new slug.
- **Templates (setup)** — imported as a new **project**: its instructions and
  default tools, plus any bundled agent or workflow, each with a fresh id. (UI
  templates aren't imported — see [Templates](#templates).)

> **Importing never runs code.** A skill is markdown loaded on demand; agents and
> workflows only reference built-in tools. Still, a shared agent's *instructions*
> are someone else's words — read before you rely on it.

## Templates

**Templates** are the composed kind — a whole starting point rather than a single
piece. There are two:

- **Setup** (a starter-kit) — system instructions, a set of default tools, and
  optionally a bundled agent or workflow. **Use** it and it lands as a ready-to-go
  **project**; open Projects and start a chat inside it. Any starter prompts the
  author added come along as suggestions.
- **UI** (a code snippet) — a React/Tailwind component or page. HarnessStation
  doesn't run arbitrary JSX in-app, so instead of importing you **Copy code** or
  **Export** it as a `.tsx` file for your own project (or hand it to an agent). If
  the author supplied a preview image, it's shown on the card.

Use the **Setup / UI** sub-filter to narrow the list. Publish either kind from
**Templates → Publish template**, which opens a builder with a Setup/UI toggle.

## Publishing

Skills, agents, workflows and schedules each publish from their own view's
**Publish** button; templates publish from the **Publish template** button in the
Templates tab (they're composed, so they get a dedicated builder). Either way it's
a short form — name, description, your author name, tags — and your name is
remembered for next time.

Before anything is sent, machine-specific details are **stripped** — your
provider, model, and any local references. **Your API keys never leave your
machine.** Only the shareable definition is uploaded.

## Reporting

Anyone can **Report** an item that's spam, broken, malicious or offensive. Enough
independent reports auto-hide it pending review, and moderators can remove it.
Publishing is rate-limited to keep abuse down.

## Privacy

The library is served by the [gateway](../models/providers); it never
sees your prompts or keys. See [Privacy & security](../advanced/privacy).
