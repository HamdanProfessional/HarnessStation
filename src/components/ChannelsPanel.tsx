import { useStore } from "../lib/store";
import { isWeb } from "../lib/web";
import { useChannelStatus, type ChannelConfig, type ChannelKind } from "../lib/channels";
import { GetDesktopApp } from "./GetDesktopApp";

const STATE_LABEL: Record<string, string> = {
  off: "Off",
  connecting: "Connecting…",
  on: "Connected",
  error: "Error",
};

const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

/**
 * Settings › Channels. Connect Telegram / Discord so you can talk to your agent
 * from those apps — with access control and reply options. Desktop only.
 */
export function ChannelsPanel() {
  const { settings, saveSettings, agents } = useStore();
  const status = useChannelStatus();

  if (isWeb()) {
    return (
      <>
        <h2>Channels</h2>
        <p className="hint">
          Reaching your agent from Telegram or Discord keeps a live connection to those bot APIs,
          which needs the desktop app.
        </p>
        <GetDesktopApp reason="Telegram and Discord channels keep a bot connection open and talk to APIs a browser tab can't reach directly. Run them from the desktop app." />
      </>
    );
  }

  const channels = settings.channels ?? {};
  const set = (kind: ChannelKind, patch: Partial<ChannelConfig>) => {
    const cur: ChannelConfig = channels[kind] ?? { enabled: false, token: "" };
    void saveSettings({ ...settings, channels: { ...channels, [kind]: { ...cur, ...patch } } });
  };

  const card = (
    kind: ChannelKind,
    title: string,
    tokenHint: React.ReactNode,
    idLabel: string,
    extras?: (cfg: ChannelConfig) => React.ReactNode,
  ) => {
    const cfg: ChannelConfig = channels[kind] ?? { enabled: false, token: "" };
    const state = status[kind];
    return (
      <div className="provider-card">
        <div className="provider-row">
          <b className="grow">
            {title}{" "}
            <span className={`pill ${state === "on" ? "ok" : state === "error" ? "warn" : ""}`}>{STATE_LABEL[state]}</span>
          </b>
          <label className="agent-check">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => set(kind, { enabled: e.target.checked })} />
            Enable
          </label>
        </div>
        <p className="hint">{tokenHint}</p>
        <input
          type="password"
          className="grow"
          value={cfg.token}
          placeholder="Bot token"
          onChange={(e) => set(kind, { token: e.target.value })}
        />

        <div className="provider-row">
          <label className="field grow">
            <span>Handled by</span>
            <select value={cfg.agentId ?? ""} onChange={(e) => set(kind, { agentId: e.target.value || undefined })}>
              <option value="">Default (first provider, global instructions)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span>Only reply to these {idLabel} (one per line — blank = anyone)</span>
          <textarea
            rows={2}
            spellCheck={false}
            placeholder={kind === "telegram" ? "123456789\n@yourusername" : "1002003004005006"}
            defaultValue={(cfg.allowFrom ?? []).join("\n")}
            onBlur={(e) => set(kind, { allowFrom: lines(e.target.value) })}
          />
        </label>

        {extras?.(cfg)}

        <div className="provider-row" style={{ gap: 18 }}>
          <label className="agent-check">
            <input type="checkbox" checked={cfg.replyInThread ?? false} onChange={(e) => set(kind, { replyInThread: e.target.checked })} />
            Reply to the message {kind === "discord" ? "(as a reply)" : ""}
          </label>
          <label className="agent-check">
            <input type="checkbox" checked={cfg.showTyping ?? false} onChange={(e) => set(kind, { showTyping: e.target.checked })} />
            Show “typing…” while thinking
          </label>
        </div>
      </div>
    );
  };

  return (
    <>
      <h2>Channels</h2>
      <p className="hint">
        Talk to your agent from Telegram or Discord. While HarnessStation is running it stays
        connected, routes each message to the chosen agent, and replies. Bot tokens are stored in your
        settings on this machine.
      </p>
      <p className="hint" style={{ marginBottom: 14 }}>
        <b>Security:</b> a message runs the agent with its tools. Restrict who can reach it with the
        allowlist below, point it at an agent with a limited toolset, and use{" "}
        <b>Settings › Hooks &amp; guardrails</b> to block anything sensitive.
      </p>

      {card(
        "telegram",
        "Telegram",
        <>
          Create a bot with <b>@BotFather</b>, paste its token, then message your bot. Uses Bot-API
          long-polling — no public URL needed.
        </>,
        "chat ids / @usernames",
      )}

      {card(
        "discord",
        "Discord",
        <>
          Create an app at <b>discord.com/developers</b>, add a bot, enable the <b>Message Content</b>{" "}
          intent, and invite it to your server. Paste the bot token.
        </>,
        "user ids",
        (cfg) => (
          <>
            <label className="field">
              <span>Only listen in these channel ids (one per line — blank = all)</span>
              <textarea
                rows={2}
                spellCheck={false}
                placeholder="1002003004005006"
                defaultValue={(cfg.allowChannels ?? []).join("\n")}
                onBlur={(e) => set("discord", { allowChannels: lines(e.target.value) })}
              />
            </label>
            <label className="agent-check">
              <input type="checkbox" checked={cfg.mentionOnly ?? false} onChange={(e) => set("discord", { mentionOnly: e.target.checked })} />
              Only respond when @-mentioned
            </label>
          </>
        ),
      )}

      <p className="hint" style={{ marginTop: 8 }}>
        <b>Sending out:</b> give an agent the <b>Channels</b> tool group (or enable <code>telegram_send</code> /{" "}
        <code>discord_send</code> in a chat) and it can post to a chat/channel by id on its own — for
        alerts, replies elsewhere, or scheduled broadcasts.
      </p>
      {status.note && <p className="hint">Last note: {status.note}</p>}
    </>
  );
}
