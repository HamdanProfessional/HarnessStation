/**
 * Messaging channels: reach your agent from Telegram and Discord.
 *
 * While the app is running it maintains a connection to each enabled platform,
 * routes incoming messages to a chosen agent (or a default provider), and sends
 * the reply back. Telegram uses Bot-API long-polling; Discord uses the gateway
 * WebSocket. Both talk to bot APIs that don't send CORS headers / need bot auth,
 * so this is a desktop feature — on the web build it's shown as unavailable.
 *
 * Access is controlled per channel: an allowlist of who may talk to the bot and,
 * on Discord, which channels it listens in. The agent can also *send* messages
 * out through the `telegram_send` / `discord_send` tools (see sendVia).
 *
 * Security note: an incoming message runs your agent with whatever tools that
 * agent has. Point a channel at a restricted agent, use an allowlist, and lean on
 * guardrails (Settings › Hooks & guardrails).
 */
import { create } from "zustand";
import { fetch } from "@tauri-apps/plugin-http";

export type ChannelKind = "telegram" | "discord";
export type ChannelState = "off" | "connecting" | "on" | "error";

export interface ChannelConfig {
  enabled: boolean;
  token: string;
  /** Agent that handles messages; blank = a default completion with the first provider. */
  agentId?: string;
  /** Discord only: only respond when the bot is @-mentioned. */
  mentionOnly?: boolean;
  /** Allowlist of chat/user ids (or @usernames). Empty = anyone may talk to it. */
  allowFrom?: string[];
  /** Discord only: channel ids the bot listens in. Empty = every channel it can see. */
  allowChannels?: string[];
  /** Reply as a reply to the incoming message (a thread on Discord). */
  replyInThread?: boolean;
  /** Show a "typing…" indicator while the agent is thinking. */
  showTyping?: boolean;
}

export interface ChannelsSettings {
  telegram?: ChannelConfig;
  discord?: ChannelConfig;
}

/** Live connection status, for the settings panel. */
export const useChannelStatus = create<{
  telegram: ChannelState;
  discord: ChannelState;
  note: string;
  set: (k: ChannelKind, v: ChannelState, note?: string) => void;
}>((set) => ({
  telegram: "off",
  discord: "off",
  note: "",
  set: (k, v, note) => set((s) => ({ ...s, [k]: v, note: note ?? s.note })),
}));

const setStatus = (k: ChannelKind, v: ChannelState, note?: string) => useChannelStatus.getState().set(k, v, note);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Case-insensitive id/username match against an allowlist (empty = allow all). */
function allowed(list: string[] | undefined, ...values: (string | number | undefined | null)[]): boolean {
  if (!list || !list.length) return true;
  const norm = (v: unknown) => String(v ?? "").replace(/^@/, "").toLowerCase();
  const set = new Set(list.map(norm).filter(Boolean));
  return values.some((v) => v != null && set.has(norm(v)));
}

/** Run the configured agent (or a plain completion) for one incoming message. */
async function respond(text: string, cfg: ChannelConfig): Promise<string> {
  const { useStore } = await import("./store");
  const store = useStore.getState();
  try {
    if (cfg.agentId) return (await store.runAgentTask(cfg.agentId, text, () => {})).trim() || "(no output)";
    const p = store.settings.providers.find((x) => x.models.length) ?? store.settings.providers[0];
    if (!p) return "No provider is configured in HarnessStation.";
    const { chatOnce } = await import("./providers");
    const out = await chatOnce(p, p.models[0] || "", store.settings.globalInstructions || "", text, new AbortController().signal);
    return out.trim() || "(no output)";
  } catch (e) {
    return `Error: ${(e as Error).message || String(e)}`;
  }
}

// ---------- Telegram (Bot API long-polling) ----------

class TelegramChannel {
  private running = false;
  private offset = 0;
  private ctrl: AbortController | null = null;
  constructor(readonly cfg: ChannelConfig) {}

  private api(method: string) {
    return `https://api.telegram.org/bot${this.cfg.token}/${method}`;
  }
  private post(method: string, body: unknown) {
    return fetch(this.api(method), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  start() {
    this.running = true;
    setStatus("telegram", "connecting");
    void this.loop();
  }

  private async loop() {
    while (this.running) {
      this.ctrl = new AbortController();
      try {
        const res = await fetch(this.api(`getUpdates?timeout=30&offset=${this.offset}`), { signal: this.ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { ok: boolean; result: any[] };
        setStatus("telegram", "on");
        for (const u of data.result ?? []) {
          this.offset = u.update_id + 1;
          if (u.message?.text) await this.handle(u.message);
        }
      } catch (e) {
        if (!this.running) break;
        setStatus("telegram", "error", (e as Error).message);
        await sleep(3000);
      }
    }
  }

  private async handle(m: any) {
    const from = m.from ?? {};
    if (!allowed(this.cfg.allowFrom, m.chat?.id, from.id, from.username)) return;
    if (this.cfg.showTyping) void this.post("sendChatAction", { chat_id: m.chat.id, action: "typing" }).catch(() => {});
    const reply = await respond(String(m.text), this.cfg);
    try {
      await this.post("sendMessage", {
        chat_id: m.chat.id,
        text: reply.slice(0, 4096),
        ...(this.cfg.replyInThread ? { reply_to_message_id: m.message_id } : {}),
      });
    } catch {
      /* send failed */
    }
  }

  stop() {
    this.running = false;
    this.ctrl?.abort();
    setStatus("telegram", "off");
  }
}

// ---------- Discord (gateway WebSocket + REST replies) ----------

const DISCORD_INTENTS = (1 << 9) | (1 << 12) | (1 << 15); // GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const discordApi = (path: string) => `https://discord.com/api/v10/${path}`;

class DiscordChannel {
  private running = false;
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private botId = "";
  private queue: Promise<void> = Promise.resolve();
  constructor(readonly cfg: ChannelConfig) {}

  start() {
    this.running = true;
    this.connect();
  }

  private connect() {
    setStatus("discord", "connecting");
    this.ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
    this.ws.onmessage = (e) => this.onGateway(JSON.parse(e.data as string));
    this.ws.onerror = () => setStatus("discord", "error");
    this.ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.running) setTimeout(() => this.running && this.connect(), 3000);
      else setStatus("discord", "off");
    };
  }

  private send(op: number, d: unknown) {
    this.ws?.send(JSON.stringify({ op, d }));
  }
  private rest(path: string, body: unknown) {
    return fetch(discordApi(path), {
      method: "POST",
      headers: { Authorization: `Bot ${this.cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private onGateway(msg: any) {
    if (typeof msg.s === "number") this.seq = msg.s;
    if (msg.op === 10) {
      const interval = msg.d.heartbeat_interval as number;
      this.heartbeat = setInterval(() => this.send(1, this.seq), interval);
      this.send(2, {
        token: this.cfg.token,
        intents: DISCORD_INTENTS,
        properties: { os: "harnessstation", browser: "harnessstation", device: "harnessstation" },
      });
    } else if (msg.op === 0) {
      if (msg.t === "READY") {
        this.botId = msg.d?.user?.id ?? "";
        setStatus("discord", "on");
      } else if (msg.t === "MESSAGE_CREATE") {
        this.queue = this.queue.then(() => this.onMessage(msg.d)).catch(() => {});
      }
    } else if (msg.op === 7 || msg.op === 9) {
      this.ws?.close();
    }
  }

  private async onMessage(m: any) {
    if (!this.running || m?.author?.bot) return;
    if (!allowed(this.cfg.allowChannels, m.channel_id)) return;
    if (!allowed(this.cfg.allowFrom, m.author?.id, m.author?.username)) return;
    const mentioned = (m.mentions ?? []).some((u: any) => u.id === this.botId);
    if (this.cfg.mentionOnly && !mentioned) return;
    const text = String(m.content ?? "").replace(new RegExp(`<@!?${this.botId}>`, "g"), "").trim();
    if (!text) return;
    if (this.cfg.showTyping) void this.rest(`channels/${m.channel_id}/typing`, {}).catch(() => {});
    const reply = await respond(text, this.cfg);
    try {
      await this.rest(`channels/${m.channel_id}/messages`, {
        content: reply.slice(0, 2000),
        ...(this.cfg.replyInThread ? { message_reference: { message_id: m.id, channel_id: m.channel_id, guild_id: m.guild_id } } : {}),
      });
    } catch {
      /* reply failed */
    }
  }

  stop() {
    this.running = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    setStatus("discord", "off");
  }
}

// ---------- outbound send (used by the telegram_send / discord_send tools) ----------

/** Send a message to a specific chat/channel via the configured bot. Returns a status line. */
export async function sendVia(kind: ChannelKind, target: string, text: string): Promise<string> {
  const { useStore } = await import("./store");
  const cfg = useStore.getState().settings.channels?.[kind];
  if (!cfg?.token) return `The ${kind} channel isn't configured (add a bot token in Settings › Channels).`;
  const t = target.trim();
  if (!t) return "No target id given.";
  try {
    if (kind === "telegram") {
      const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: t, text: text.slice(0, 4096) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else {
      const res = await fetch(discordApi(`channels/${t}/messages`), {
        method: "POST",
        headers: { Authorization: `Bot ${cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.slice(0, 2000) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    return `Sent to ${kind} ${t}.`;
  } catch (e) {
    return `Failed to send to ${kind} ${t}: ${(e as Error).message}`;
  }
}

// ---------- lifecycle ----------

let telegram: TelegramChannel | null = null;
let discord: DiscordChannel | null = null;
let tgKey = "";
let dcKey = "";

/** Start/stop connectors to match the current settings. Call after boot and on change. */
export function syncChannels(channels: ChannelsSettings | undefined): void {
  const t = channels?.telegram;
  const wantT = !!(t?.enabled && t.token.trim());
  const kT = wantT ? JSON.stringify(t) : "";
  if (kT !== tgKey) {
    telegram?.stop();
    telegram = wantT ? new TelegramChannel(t!) : null;
    telegram?.start();
    tgKey = kT;
  }

  const d = channels?.discord;
  const wantD = !!(d?.enabled && d.token.trim());
  const kD = wantD ? JSON.stringify(d) : "";
  if (kD !== dcKey) {
    discord?.stop();
    discord = wantD ? new DiscordChannel(d!) : null;
    discord?.start();
    dcKey = kD;
  }
}

export function stopChannels(): void {
  telegram?.stop();
  discord?.stop();
  telegram = discord = null;
  tgKey = dcKey = "";
}
