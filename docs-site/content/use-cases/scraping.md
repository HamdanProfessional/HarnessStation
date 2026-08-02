---
title: Pulling data off websites
description: Collecting structured information from pages that have no API — and knowing when this is the wrong approach.
---

# Pulling data off websites

The [browser tools](../guide/browser) let the model open pages, read them, and
pull out what you need.

## Read this first

**If the site has an API, use the API.** It's faster, cheaper, more reliable, and
doesn't break when the page layout changes. Browser automation is for sites that
don't offer one.

**Check what you're allowed to do.** Terms of service and robots.txt exist, and
"a model did it" isn't a defence. This applies with more force to personal data
than to public prices.

**Sites with anti-bot measures will block it.** Nothing here evades detection,
and that's deliberate.

## Setup

The **Browser** tool group. The in-app browser is the default and right for most
work — it keeps its own logins, separate from your normal browser.

Use the extension instead when a site needs a session you already have in Chrome.
→ [Browser control](../guide/browser)

## One page

Start here even if you want many, because it tells you whether the approach works
at all:

```text
Open example.com/products/widget and give me the name, price,
availability, and any specifications listed.
```

Watch it work. It opens the page, reads the text, and answers from what's there.

If the result is wrong, look at the tool cards in the conversation before
changing your prompt — you'll usually see it read a cookie banner or a "page not
found", which is a different problem from misreading the content.

## Several pages

```text
For each of these URLs, get the name and price. Return a table.
If a page won't load or a field is missing, say so in that row
rather than skipping it.

https://example.com/a
https://example.com/b
https://example.com/c
```

The instruction about failures is the important one. Rows that quietly vanish
turn a partial result into a complete-looking one, and you won't notice until the
numbers are wrong downstream.

## Pages behind a login

Sign in yourself, in the browser panel. The session persists, so this is once
rather than every run.

> **Warning:** Once signed in, the model can act as you on that site. Treat it
> as delegated access, and prefer read-only tasks.

## Navigating

The model can click through rather than being given URLs:

```text
Open example.com, find the pricing page, and tell me what each tier costs.
```

It uses `list_buttons` to see what's clickable, then `click_button`. This is
slower and less reliable than direct URLs — pages change, labels are ambiguous —
so give URLs where you have them.

## Saving results

With the Files group on:

```text
Save that table as data/prices.csv.
```

To repeat it, turn it into a [workflow and schedule](recurring-report).

## Where it goes wrong

**It reads the cookie banner.** The overlay is the page's visible text. Ask it to
dismiss the banner first, or click the accept button by label.

**Content isn't there.** Pages rendering after load may not be ready when it
reads. Ask it to wait and read again.

**Prices are wrong.** Regional pricing, currency, or a logged-out view. Check what
the page shows in the panel — you're looking at exactly what it read.

**It gets slower over many pages.** Each page's text goes into context. Work in
batches and save results as you go rather than holding thirty pages in one
conversation.

**It's blocked.** Some sites will block it, and that's the end of the road for
this approach. Look for an API, an export, or a data source.
