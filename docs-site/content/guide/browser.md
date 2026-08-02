---
title: Browser control
description: A browser inside the conversation that the model can read and click — and the option to drive your own Chrome instead.
---

# Browser control

The model can use a web browser: open pages, read them, click things, fill forms.
You watch it happen.

## Two ways to do it

**In-app** (the default) — a browser panel appears in the conversation. Sites you
sign into stay signed in, in the app's own session store, separate from your
normal browser.

**Your own browser** — a Chrome/Edge extension lets the model drive the browser
you already use, with the sessions you're already signed into. Set up from
**Automation › Browser**: enable Developer mode on the extensions page, choose
**Load unpacked**, and select the `extension` folder. Only this option can take
screenshots.

Most tasks want the in-app browser. Reach for the extension when a task needs a
login you have there and don't want to repeat.

## Using it

Turn on the **Browser** tool group in a chat, then ask for something:

```text
Open the pricing page for example.com and tell me what the tiers cost.
```

The panel opens on its own if it isn't already, and you'll see each step: it
navigates, reads the page, and answers from what it found.

## What it can do

| Tool | |
| --- | --- |
| `open_url` | Go to a page and wait for it to load |
| `read_all_text` | The page's visible text |
| `find_text` | Just the passages matching a phrase |
| `list_buttons` | Everything clickable, by label |
| `click_button` | Click one, then wait for navigation |
| `take_screenshot` / `read_screenshot` | Capture an image, then look at it |
| `open_new_tab`, `list_tabs`, `change_tab`, `close_tab` | Tabs *(extension only)* |

The design keeps cheap steps first. Reading text costs a fraction of a
screenshot, so the model is told to try that first and only capture an image when
text hasn't answered the question. Screenshots are also split in two —
*taking* one is free, and only *looking* at it spends context.

## Why it isn't an iframe

The panel looks like an embedded frame but is a real browser window positioned
over the page. It has to be: a cross-origin iframe can't be scripted, so the
model couldn't read or click anything, and most sites worth automating refuse to
be framed at all.

The visible consequence is that the browser sits *below* the conversation rather
than scrolling inside it. That's deliberate — moving a native browser view as you
scroll caused the app to freeze, so it now holds still while you read.

## Limits worth knowing

- **The in-app browser can't screenshot.** Use the extension if you need images.
- **The in-app browser has one view, not tabs.** Tab tools need the extension.
- **Anti-bot measures apply.** Sites with aggressive bot detection may block or
  challenge it. Nothing here evades that.
- **It's slow relative to an API.** If a site has one, that's the better route.

## Sessions and safety

In-app logins are stored in the app's own browser data directory and persist
across restarts. They're separate from your everyday browser, so signing in here
doesn't touch your normal session.

The model can only act in the browser panel — it can't reach your other
applications. But it *can* act on any site you've signed into within it, so treat
a signed-in session there as something you've delegated.
