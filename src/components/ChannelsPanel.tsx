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

/**
 * Settings › Channels. Connect Telegram / Discord so you can talk to your agent
 * from those apps. Desktop only — the bot APIs need direct (non-CORS) access.
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

  const card = (kind: ChannelKind, title: string, hint: React.ReactNode, extras?: React.ReactNode) => {
    const cfg: ChannelConfig = channels[kind] ?? { enabled: false, token: "" };
    const state = status[kind];
    return (
      <div className="provider-card">
        <div className="provider-row">
          <b className="grow">
            {title}{" "}
            <span className={`pill ${state === "on" ? "ok" : state === "error" ? "warn" : ""}`}>
              {STATE_LABEL[state]}
            </span>
          </b>
          <label className="agent-check">
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => set(kind, { enabled: e.target.checked })} />
            Enable
          </label>
        </div>
        <p className="hint">{hint}</p>
        <input
          type="password"
          className="grow"
          value={cfg.token}
          placeholder="Bot token"
          onChange={(e) => set(kind, { token: e.target.value })}
        />
        <label className="field">
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
        {extras}
      </div>
    );
  };

  return (
    <>
      <h2>Channels</h2>
      <p className="hint">
        Talk to your agent from Telegram or Discord. While HarnessStation is running it stays
        connected, routes each message to the chosen agent, and replies. The bot tokens are stored in
        your settings on this machine.
      </p>
      <p className="hint" style={{ marginBottom: 14 }}>
        <b>Security:</b> a message runs the agent with its tools. Point a channel at an agent with a
        restricted toolset, and use <b>Settings › Hooks &amp; guardrails</b> to block or gate
        anything sensitive — a remote sender shouldn't be able to run your terminal.
      </p>

      {card(
        "telegram",
        "Telegram",
        <>
          Create a bot with <b>@BotFather</b>, copy its token here, then message your bot. Uses Bot-API
          long-polling.
        </>,
      )}

      {card(
        "discord",
        "Discord",
        <>
          Create an application at <b>discord.com/developers</b>, add a bot, enable the{" "}
          <b>Message Content</b> intent, and invite it to your server. Paste the bot token here.
        </>,
        (() => {
          const cfg: ChannelConfig = channels.discord ?? { enabled: false, token: "" };
          return (
            <label className="agent-check">
              <input
                type="checkbox"
                checked={cfg.mentionOnly ?? false}
                onChange={(e) => set("discord", { mentionOnly: e.target.checked })}
              />
              Only respond when @-mentioned
            </label>
          );
        })(),
      )}

      {status.note && <p className="hint">Last note: {status.note}</p>}
    </>
  );
}
