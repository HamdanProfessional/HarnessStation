---
title: Community library
description: Publish and import skills, agents, workflows and schedules made by other people.
---

# Community library

The community library is a public, account-free marketplace built into the app
for user-made **skills, agents, workflows and schedules**. Import what others
have made, or publish your own — all free.

Open it from the sidebar: **Library › Community**.

## Browsing

- **Filter by type** — All, Skills, Agents, Workflows, Schedules.
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

> **Importing never runs code.** A skill is markdown loaded on demand; agents and
> workflows only reference built-in tools. Still, a shared agent's *instructions*
> are someone else's words — read before you rely on it.

## Publishing

Every Skills / Agents / Workflows / Schedules view has a **Publish** button. It
opens a short form (name, description, your author name, tags). Your name is
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
