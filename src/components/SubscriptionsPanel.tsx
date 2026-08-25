import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";
import { isWeb } from "../lib/web";
import type { Provider } from "../lib/types";
import {
  claudeAuthorizeUrl,
  claudeExchange,
  clearTokens,
  connectedStatus,
  copilotDevicePoll,
  copilotDeviceStart,
  copilotToken,
  parsePastedCode,
  pkcePair,
  randomState,
  storeTokens,
  CLAUDE_MODELS,
  COPILOT_BASE_URL,
  COPILOT_MODELS,
  type DeviceFlowStart,
  type OAuthTokens,
} from "../lib/oauthProviders";

/**
 * Settings → Subscriptions: connect a Claude Pro/Max or GitHub Copilot
 * subscription as a backend. Tokens live in the OS keychain; the provider
 * entries these flows create carry only an `auth` marker. These flows present
 * the official clients' identity — tolerated today, revocable any quarter, so
 * the panel says so plainly. One person's own subscription is the intended use.
 */

type Status = "not-connected" | "valid" | "expired";

const CLAUDE_ID = "claude-oauth";
const COPILOT_ID = "copilot-oauth";

const claudeProvider = (): Provider => ({
  id: CLAUDE_ID,
  name: "Claude (subscription)",
  kind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "oauth",
  auth: "oauth-claude",
  models: [...CLAUDE_MODELS],
});

const copilotProvider = (): Provider => ({
  id: COPILOT_ID,
  name: "GitHub Copilot",
  kind: "openai-compatible",
  baseUrl: COPILOT_BASE_URL,
  apiKey: "oauth",
  auth: "oauth-copilot",
  models: [...COPILOT_MODELS],
});

const STATUS_LABEL: Record<Status, string> = {
  "not-connected": "Not connected",
  valid: "Connected",
  expired: "Connected — token will refresh on next use",
};

export function SubscriptionsPanel() {
  const { saveSettings, updateChat } = useStore();
  const [claudeStatus, setClaudeStatus] = useState<Status>("not-connected");
  const [copilotStatus, setCopilotStatus] = useState<Status>("not-connected");
  const [claudeCode, setClaudeCode] = useState("");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [device, setDevice] = useState<DeviceFlowStart | null>(null);
  const [copilotNote, setCopilotNote] = useState("");

  // PKCE material lives only for the browser round-trip.
  const verifierRef = useRef("");
  const stateRef = useRef("");
  // Cancels the device-flow poll loop on unmount or disconnect.
  const runRef = useRef(0);

  const refreshStatuses = async () => {
    setClaudeStatus(await connectedStatus(CLAUDE_ID));
    setCopilotStatus(await connectedStatus(COPILOT_ID));
  };
  useEffect(() => {
    void refreshStatuses();
  }, []);

  // Fresh store state: sibling panels save while this one is open.
  const upsertProvider = async (p: Provider) => {
    const cur = useStore.getState().settings;
    const providers = cur.providers.some((x) => x.id === p.id)
      ? cur.providers.map((x) => (x.id === p.id ? p : x))
      : [...cur.providers, p];
    await saveSettings({ ...cur, providers });
  };

  const disconnect = async (id: string) => {
    runRef.current++; // cancels any poll loop
    await clearTokens(id);
    const cur = useStore.getState().settings;
    await saveSettings({ ...cur, providers: cur.providers.filter((x) => x.id !== id) });
    await refreshStatuses();
    if (id === COPILOT_ID) {
      setDevice(null);
      setCopilotNote("");
    }
    toast.success("Disconnected — tokens removed from the keychain.");
  };

  const connectClaude = async () => {
    setClaudeBusy(true);
    try {
      const { verifier, challenge } = await pkcePair();
      const state = randomState();
      verifierRef.current = verifier;
      stateRef.current = state;
      await openUrl(claudeAuthorizeUrl(challenge, state));
      toast.success("Browser opened — approve, then paste the code it shows.");
    } catch (e) {
      toast.error((e as Error).message || String(e));
    } finally {
      setClaudeBusy(false);
    }
  };

  const finishClaude = async () => {
    if (!verifierRef.current) {
      toast.error("Click Connect first, then paste the code the browser shows.");
      return;
    }
    setClaudeBusy(true);
    try {
      const { code, state } = parsePastedCode(claudeCode);
      if (!code) throw new Error("That doesn't look like a code — copy the whole string it shows.");
      if (state && stateRef.current && state !== stateRef.current) {
        throw new Error("That code is from a different attempt — click Connect and start again.");
      }
      const tokens = await claudeExchange(code, verifierRef.current);
      verifierRef.current = "";
      stateRef.current = "";
      setClaudeCode("");
      await storeTokens(CLAUDE_ID, tokens);
      await upsertProvider(claudeProvider());
      await refreshStatuses();
      // Land on a working model, the same way the first-run key flow does —
      // connecting and then hunting for the model picker is a dead end.
      updateChat({ providerId: CLAUDE_ID, model: CLAUDE_MODELS[0] });
      toast.success("Claude subscription connected — send a message.");
    } catch (e) {
      toast.error((e as Error).message || String(e));
    } finally {
      setClaudeBusy(false);
    }
  };

  const connectCopilot = async () => {
    setCopilotBusy(true);
    setCopilotNote("");
    const run = ++runRef.current;
    try {
      const start = await copilotDeviceStart();
      setDevice(start);
      await openUrl(start.verificationUrl);
      setCopilotNote(`Enter code ${start.userCode} at the GitHub page.`);
      const deadline = Date.now() + start.expiresSec * 1000;
      let intervalMs = start.intervalSec * 1000;
      for (;;) {
        if (run !== runRef.current) return;
        if (Date.now() > deadline) throw new Error("The device code expired — start again.");
        await new Promise((r) => setTimeout(r, intervalMs));
        if (run !== runRef.current) return;
        const poll = await copilotDevicePoll(start.deviceCode);
        if (poll.status === "pending") continue;
        if (poll.status === "slow_down") {
          intervalMs *= 2;
          continue;
        }
        if (poll.status === "error") throw new Error(poll.message);
        // done — the GitHub token trades for the short-lived Copilot bearer.
        const t = await copilotToken(poll.githubToken);
        const tokens: OAuthTokens = {
          access: t.token,
          refresh: poll.githubToken,
          expiresAt: t.expiresAt,
          account: t.account,
        };
        await storeTokens(COPILOT_ID, tokens);
        await upsertProvider(copilotProvider());
        await refreshStatuses();
        setDevice(null);
        setCopilotNote(t.account ? `Connected as ${t.account}.` : "");
        updateChat({ providerId: COPILOT_ID, model: COPILOT_MODELS[0] });
        toast.success("GitHub Copilot connected — send a message.");
        return;
      }
    } catch (e) {
      if (run === runRef.current) {
        setCopilotNote((e as Error).message || String(e));
        toast.error((e as Error).message || String(e));
      }
    } finally {
      if (run === runRef.current) setCopilotBusy(false);
    }
  };

  if (isWeb()) {
    return (
      <section>
        <h2>Subscriptions</h2>
        <p className="hint">
          Subscription backends need the OS keychain, which the browser build doesn't have. Use the
          desktop app.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Subscriptions</h2>
      <p className="hint">
        Use a subscription you already pay for as a backend. Tokens live in your OS keychain —
        settings.json never sees them.
      </p>

      <div className="provider-card" style={{ marginBottom: 12 }}>
        <h3>Claude (Pro/Max)</h3>
        <p className="hint">
          Approve in the browser, then paste back the code it shows. Serves the Anthropic protocol —{" "}
          {CLAUDE_MODELS.join(", ")}.
        </p>
        <div className="provider-row">
          <span className="hint">{STATUS_LABEL[claudeStatus]}</span>
          <div className="grow" />
          <button className="btn" disabled={claudeBusy} onClick={() => void connectClaude()}>
            {claudeStatus === "not-connected" ? "Connect" : "Reconnect"}
          </button>
          {claudeStatus !== "not-connected" && (
            <button className="btn danger" disabled={claudeBusy} onClick={() => void disconnect(CLAUDE_ID)}>
              Disconnect
            </button>
          )}
        </div>
        {claudeStatus === "not-connected" && (
          <div className="provider-row">
            <input
              className="grow"
              value={claudeCode}
              placeholder="Paste the code from the browser, e.g. abc#12345"
              onChange={(e) => setClaudeCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void finishClaude()}
            />
            <button
              className="btn primary"
              disabled={claudeBusy || !claudeCode.trim()}
              onClick={() => void finishClaude()}
            >
              Finish
            </button>
          </div>
        )}
      </div>

      <div className="provider-card" style={{ marginBottom: 12 }}>
        <h3>GitHub Copilot</h3>
        <p className="hint">
          Device flow: type the code GitHub shows at the browser page. OpenAI-compatible endpoint —{" "}
          {COPILOT_MODELS.join(", ")}.
        </p>
        <div className="provider-row">
          <span className="hint">
            {STATUS_LABEL[copilotStatus]}
            {copilotNote ? ` — ${copilotNote}` : ""}
          </span>
          <div className="grow" />
          {device && <span className="hint code-hint">{device.userCode}</span>}
          <button className="btn" disabled={copilotBusy} onClick={() => void connectCopilot()}>
            {copilotStatus === "not-connected" ? "Connect" : "Reconnect"}
          </button>
          {copilotStatus !== "not-connected" && (
            <button className="btn danger" disabled={copilotBusy} onClick={() => void disconnect(COPILOT_ID)}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      <p className="hint">
        These flows identify as the official clients. Providers tolerate that today and can change
        their terms at any time — connect your own subscription, and read its terms.
      </p>
    </section>
  );
}
