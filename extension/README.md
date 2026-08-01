# HarnessStation browser bridge

Lets HarnessStation drive **the browser you already use**, with the sessions
you're already signed in to. Nothing about your browser changes: no debug flags,
no separate profile, no relaunch.

## Install (Chrome, Edge, Brave — any Chromium browser)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this `extension` folder.
4. Start HarnessStation. The extension icon's popup should say **Connected**.

## How it works

The extension keeps a WebSocket to `127.0.0.1:8791`, which HarnessStation
listens on. The app sends `{id, action, args}`; the extension performs the
action in your real tabs and replies. Loopback only — nothing outside your
machine can reach it, and the extension talks to nothing else.

## What it can do

`open_url`, `read_all_text`, `find_text`, `list_buttons`, `click_button`,
`take_screenshot`, `read_screenshot`, `open_new_tab`, `list_tabs`, `change_tab`,
`close_tab`, `close_browser`.

## Two deliberate limits

- **`close_browser` closes only the tabs HarnessStation opened**, never your
  whole browser. Your other work isn't something a model should be able to
  discard.
- **No typing or form filling.** Reading and clicking is a much smaller blast
  radius than entering text into pages you're logged into. If you want it, it
  should be added knowingly rather than by default.

Because it acts as *you*, treat it like handing someone your logged-in browser:
it can see and click anything your sessions can.
