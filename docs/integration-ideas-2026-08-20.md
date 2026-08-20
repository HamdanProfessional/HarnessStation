# Integration ideas — 20 Aug 2026

Prompted by "somewhere we can integrate this, like ADB". Researched from the live
web today; nothing here is built.

The short answer on ADB specifically: **do not build it in-tree.** The longer
answer is that the question points at something more valuable than ADB.

---

## First, the disappointing part

Driving an Android phone from an LLM is **already a crowded category**. There are
at least six MCP servers doing it — `minhalvp/android-mcp-server`, ADB Control,
Android-MCP, Mobile MCP (iOS *and* Android), `mcp-scrcpy-vision`, and more. They
cover tap, swipe, text, keyevents, screencap, install, launch, logcat, battery.
They work today with Claude Desktop and Cursor.

HarnessStation already speaks MCP over stdio and HTTP, with progressive
disclosure. **So it already has ADB support** — connect one of those servers and
it works this afternoon. Writing our own would be re-implementing a solved,
commoditised thing.

`freeze.md` already says this in the general case: *"Making features into MCP
servers — the structural fix... a small core plus independently-versioned
satellites is the only shape one person can sustain."* An in-tree ADB integration
would be exactly the mistake that document exists to prevent.

One technical note worth keeping if anyone does evaluate those servers: **raw ADB
is blind.** It can tap and swipe but has no idea what's on screen, and
`screencap` costs 500–1500 ms per frame, which stalls the agent loop. The servers
worth using pair a scrcpy control stream (~5–10 ms per action, vs ~100–300 ms for
`adb shell input`) with Android's Accessibility APIs for structured screen XML.
If a server only wraps `adb shell`, it will feel broken on anything non-trivial.

---

## The idea the question is actually pointing at

Everyone shipping a local agent in 2026 has the same shape: **one host, plus MCP
servers**. Goose, Atomic Agent, AnythingLLM, Claude Desktop, Cursor. The device
the agent runs on is the whole world; anything else is a subprocess.

HarnessStation has something none of them do: **`src-tauri/src/mesh.rs`** — 962
lines of LAN discovery and pairing where the code never crosses the wire, already
sharing models, tools and knowledge between machines you own.

That is the asset. Not the chat, not the tools, not even the Value tab. **"My
devices" is a first-class concept here and nowhere else.**

The big players are converging on this from the other direction — Lenovo's Qira
(CES 2026) promises an agent that follows you across laptop, phone and wearable;
Microsoft Agent 365 is an enterprise agent control plane. Both are vendor-locked
and cloud-mediated. The local-first, no-account version of that idea is currently
unoccupied, and we are one feature away from it.

### 1. The phone as a mesh peer — not as an MCP server

The framing everyone else can't copy. Not "the agent can drive an Android device"
(six servers do that), but **"your phone is a peer in your mesh"** — same pairing,
same trust model, same shared tool surface as your other machines. ADB is just
the transport for one peer type.

What that unlocks that a single-host MCP server structurally cannot:

- The phone is reachable from *any* machine in the mesh, not just the one it's
  plugged into.
- The desktop's big model drives the phone while the phone contributes what only
  it has — camera, location, notifications, the apps you're signed into.
- Automations that a cloud agent is *legally and practically* barred from: your
  banking app, your health app, anything behind 2FA. A cloud agent cannot touch
  those. One on your own LAN, with your own key, can. That is the pitch, and it
  is only credible for a local-first product.

**Hard blocker, and it comes before any of this.** `freeze.md` states plainly
that the mesh's request bodies *"are still plaintext — a stated security hole in
a product whose whole pitch is privacy. Fixing it is not optional."* Putting a
phone — the most sensitive device a person owns — onto a plaintext LAN protocol
would be indefensible. **Encrypt the mesh first.** That work is worth doing
regardless; this idea just makes it urgent.

### 2. Model routing across your own devices

`ai-landscape-2026-08-16.md` flagged Nemo Switchyard (routing) and a bundled
tiny-model tier as separate leads. The mesh is what fuses them into something
nobody else can ship.

The pieces are real and on Hugging Face today:

| Piece | What it does | Downloads |
|---|---|---|
| `LiquidAI/LFM2.5-Encoder-350M-Prompt-Router` | decides which model a turn needs | 4.4k |
| `LiquidAI/LFM2.5-2.6B-GGUF` | on-device agentic model, <2.5 GB quantized | 392k |
| `LiquidAI/LFM2.5-1.2B-Instruct-GGUF` | smaller tier | 239k |

The router is **350M** — small enough to run on every peer, including the phone.
So: the router decides locally; mechanical turns (titling, memory extraction,
tool-argument shaping, "does this even need the big model") run on-device in
milliseconds; everything else routes over the mesh to whichever peer has the GPU.

Everyone else routes between *APIs*. This routes between *machines you own*,
which is only possible because the mesh exists.

Immediate, unrelated bonus — **done while writing this.** The catalog was still
shipping `LFM2-1.2B`, a generation behind. It now ships `LFM2.5-1.2B-Instruct`
and adds `LFM2.5-2.6B`, the on-device agentic tier, with real byte-count sizes
and both download URLs checked for a 200. That stands on its own merits whatever
happens to the rest of this.

### 3. The browser VM as the sandbox for model-written code

Already shipped and under-used. The web build boots a real Linux kernel, CPython
and a persistent filesystem in a tab via v86. Today it backs the file browser.

It is also the obvious place to run code the model wrote, in the one sandbox that
cannot touch the user's actual machine. "The agent runs its own code in a real
kernel that isn't yours" is a security story no competitor can tell, because
nobody else ships a kernel in a tab.

### 4. Give the background agent something to watch

The research was blunt about where the category is going: the dividing line
between a chatbot and an assistant is a thing that **stays running and tells you
when something needs attention**.

We are most of the way there and may not have noticed: tray-resident with the
window closed, `tickSchedules` every 60s, Telegram and Discord channels wired in.
OpenClaw's entire pitch — "your agent lives where you already are: WhatsApp,
Telegram, Signal, Discord" — is a feature we shipped.

What is missing is anything to *watch*. Schedules fire on a clock; nothing fires
on a change. A watch trigger — a file, a folder, a feed, a mesh peer's state —
turns an existing feature into the category's dividing line.

### 5. Publish the Value tab as an MCP server

Inverted distribution. Live prices for ~6,700 models, no key, no account, sourced
from providers' own published lists — genuinely nobody else has it.

Exposed as an MCP server, *other* harnesses consume it: Claude Desktop, Cursor,
Goose. Their users hit a HarnessStation-branded tool answering "what would this
workload actually cost". Cheapest distribution available, and it fits the
satellite architecture `freeze.md` argues for.

---

## Ranking

| Idea | Unique to us? | Cost | Blocked on |
|---|---|---|---|
| Encrypt the mesh | — (prerequisite) | M | nothing — already overdue |
| 2. Mesh model routing | **Yes** — needs the mesh | M–L | mesh encryption |
| 1. Phone as mesh peer | **Yes** — needs the mesh | L | mesh encryption |
| 4. Watch triggers | Partly | S | nothing |
| 5. Value as MCP server | **Yes** — nobody has the data | S–M | nothing |
| 3. VM as code sandbox | **Yes** — nobody ships a kernel in a tab | M | nothing |
| ~~Bump LFM2 → LFM2.5 in the catalog~~ | No | XS | **done** |

**Suggested order:** the catalog bump is done. Next #5 and #4, both small and
unblocked. Then mesh encryption, which is owed anyway and is the gate on the two
ideas that are genuinely defensible.

**Do not** build ADB in-tree. If someone wants phone control this week, connect
an existing MCP server — that is what the MCP support is for.

---

## Caveats

- Web research, not evaluation. No ADB MCP server here has been run.
- Competitor claims (Qira, Agent 365, OpenClaw) are from vendor announcements and
  roundups, not hands-on.
- Download counts are today's and move fast.
- Assistant knowledge cutoff is May 2026; everything above was gathered live on
  2026-08-20.
