import { oauthLoad, oauthSave, oauthClear } from "./storage";
import type { Provider } from "./types";

/**
 * Subscription OAuth providers — your Claude Pro/Max or GitHub Copilot
 * subscription as a backend, the way the local-router category does it.
 *
 * Two flows, deliberately different shapes:
 *
 * - **Claude (Pro/Max)**: authorization-code + PKCE. Claude's callback page
 *   cannot redirect to a loopback port, so the user copies the code it shows
 *   and pastes it back (`parsePastedCode` handles the `code#state` form the
 *   page displays). Tokens speak the Anthropic Messages protocol with
 *   `Authorization: Bearer` instead of `x-api-key`, plus the OAuth beta flag.
 * - **GitHub Copilot**: device flow (type a code at github.com/login/device),
 *   then the GitHub token is exchanged for a short-lived Copilot token. The
 *   chat endpoint is OpenAI-compatible, so it rides the existing
 *   openai-compatible path with two editor headers.
 *
 * Tokens live in the OS keychain under `oauth:<providerId>`; settings.json
 * carries only the provider entry with an `auth` marker. Desktop only.
 *
 * An honest note that also ships in the UI: these flows work by presenting
 * the official clients' identities. Providers tolerate that today and can
 * change their terms at any time — connect your own subscription, read its
 * terms, and don't build a business on it.
 */

// ---------- Claude (Pro/Max) ----------

export const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const CLAUDE_TOKEN_URL = "https://platform.claude.com/api/oauth/token";
export const CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
export const CLAUDE_SCOPES = "org:create_api_key user:profile user:inference";

/** Models the subscription serves. Editable in My Models like any provider. */
export const CLAUDE_MODELS = ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"];

// ---------- GitHub Copilot ----------

export const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
export const COPILOT_DEVICE_URL = "https://github.com/login/device/code";
export const COPILOT_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const COPILOT_EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
/** The chat endpoint is OpenAI-compatible and expects an editor identity. */
export const COPILOT_BASE_URL = "https://api.githubcopilot.com";
export const COPILOT_EDITOR_VERSION = "vscode/1.110.0";
export const COPILOT_PLUGIN_VERSION = "copilot-chat/0.28.0";
export const COPILOT_MODELS = ["gpt-4.1", "gpt-4o", "o3"];

// ---------- PKCE + small crypto ----------

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A code verifier + S256 challenge, per RFC 7636. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * The Claude callback page shows `code#state` as one string; users paste the
 * whole thing. Accept that, a bare code, or a full callback URL.
 */
export function parsePastedCode(raw: string): { code: string; state?: string } {
  let s = raw.trim();
  const urlMatch = /[?&]code=([^&#]+)(?:[&#]state=([^&#]+))?/.exec(s);
  if (urlMatch) {
    return { code: decodeURIComponent(urlMatch[1]), state: urlMatch[2] ? decodeURIComponent(urlMatch[2]) : undefined };
  }
  const hash = s.includes("#") ? s.split("#") : null;
  if (hash) return { code: hash[0].trim(), state: hash[1]?.trim() || undefined };
  return { code: s };
}

// ---------- token shape + expiry ----------

export interface OAuthTokens {
  access: string;
  refresh: string;
  /** Epoch ms after which the access token needs a refresh. */
  expiresAt: number;
  /** Copilot only: the GitHub login the subscription belongs to. */
  account?: string;
}

export function isExpired(t: OAuthTokens | null, now = Date.now(), skewMs = 120_000): boolean {
  if (!t?.access) return true;
  return now >= t.expiresAt - skewMs;
}

// ---------- Claude token endpoints ----------

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

async function postForm(url: string, body: Record<string, string>, fetchImpl: FetchImpl): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function tokensFrom(json: { access_token?: string; refresh_token?: string; expires_in?: number }): OAuthTokens {
  if (!json.access_token) throw new Error("The token response had no access token.");
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? "",
    // Refresh a little early; the server's lifetime is a hint, not a lease.
    expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 300) * 1000,
  };
}

/** Exchange the pasted authorization code for tokens (consumes the verifier). */
export async function claudeExchange(
  code: string,
  verifier: string,
  fetchImpl: FetchImpl = fetch,
): Promise<OAuthTokens> {
  const res = await postForm(
    CLAUDE_TOKEN_URL,
    {
      grant_type: "authorization_code",
      code,
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: CLAUDE_REDIRECT_URI,
      code_verifier: verifier,
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Claude token exchange failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return tokensFrom(await res.json());
}

export async function claudeRefresh(refreshToken: string, fetchImpl: FetchImpl = fetch): Promise<OAuthTokens> {
  const res = await postForm(
    CLAUDE_TOKEN_URL,
    { grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLAUDE_CLIENT_ID },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Claude token refresh failed: HTTP ${res.status} — reconnect in Settings → Subscriptions.`);
  return tokensFrom(await res.json());
}

export function claudeAuthorizeUrl(challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: CLAUDE_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: CLAUDE_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${CLAUDE_AUTHORIZE_URL}?${q.toString()}`;
}

// ---------- Copilot: device flow + token exchange ----------

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalSec: number;
  expiresSec: number;
}

export async function copilotDeviceStart(fetchImpl: FetchImpl = fetch): Promise<DeviceFlowStart> {
  const res = await fetchImpl(COPILOT_DEVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: COPILOT_CLIENT_ID, scope: "read:user" }),
  });
  if (!res.ok) throw new Error(`GitHub device flow failed: HTTP ${res.status}`);
  const j = (await res.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    interval?: number;
    expires_in?: number;
  };
  if (!j.device_code || !j.user_code || !j.verification_uri) throw new Error("GitHub device flow response was incomplete.");
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUrl: j.verification_uri,
    intervalSec: j.interval ?? 5,
    expiresSec: j.expires_in ?? 900,
  };
}

export type DevicePoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "done"; githubToken: string }
  | { status: "error"; message: string };

/** One poll of the device-flow token endpoint. The caller owns the cadence. */
export async function copilotDevicePoll(deviceCode: string, fetchImpl: FetchImpl = fetch): Promise<DevicePoll> {
  const res = await fetchImpl(COPILOT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  switch (j.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case undefined:
      if (j.access_token) return { status: "done", githubToken: j.access_token };
      return { status: "error", message: "GitHub returned no token and no error." };
    default:
      return { status: "error", message: j.error_description ?? j.error };
  }
}

/** Trade the long-lived GitHub token for the short-lived Copilot bearer. */
export async function copilotToken(
  githubToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ token: string; expiresAt: number; account?: string }> {
  const res = await fetchImpl(COPILOT_EXCHANGE_URL, {
    headers: { Authorization: `token ${githubToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: HTTP ${res.status} — is Copilot on the account?`);
  const j = (await res.json()) as { token?: string; expires_at?: number; user?: string };
  if (!j.token || !j.expires_at) throw new Error("Copilot token exchange returned no token.");
  return { token: j.token, expiresAt: j.expires_at * 1000, account: j.user };
}

/** Copilot refresh = re-exchange; the GitHub token is the real credential. */
async function copilotRefresh(githubToken: string, fetchImpl: FetchImpl): Promise<OAuthTokens> {
  const t = await copilotToken(githubToken, fetchImpl);
  return { access: t.token, refresh: githubToken, expiresAt: t.expiresAt, account: t.account };
}

// ---------- broker ----------

async function loadTokens(providerId: string): Promise<OAuthTokens | null> {
  const raw = await oauthLoad(providerId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return null;
  }
}

async function saveTokens(providerId: string, t: OAuthTokens): Promise<void> {
  await oauthSave(providerId, JSON.stringify(t));
}

export async function clearTokens(providerId: string): Promise<void> {
  await oauthClear(providerId);
}

/** Save a freshly exchanged pair (connect flow). */
export async function storeTokens(providerId: string, t: OAuthTokens): Promise<void> {
  await saveTokens(providerId, t);
}

export async function connectedStatus(
  providerId: string,
  deps: { load?: typeof loadTokens; now?: () => number } = {},
): Promise<"not-connected" | "valid" | "expired"> {
  const load = deps.load ?? loadTokens;
  const t = await load(providerId);
  if (!t?.access) return "not-connected";
  return isExpired(t, deps.now?.() ?? Date.now()) ? "expired" : "valid";
}

const inflight = new Map<string, Promise<string>>();

/**
 * A valid access token for an OAuth provider, refreshing through the keychain
 * when needed. Single-flight per provider: a tool loop firing several requests
 * at token-expiry time must not race four refreshes (each refresh rotates the
 * refresh token; racing them strands all but one).
 */
export async function ensureAccessToken(
  provider: Provider,
  deps: {
    load?: typeof loadTokens;
    save?: typeof saveTokens;
    fetchImpl?: FetchImpl;
    now?: () => number;
  } = {},
): Promise<string> {
  const load = deps.load ?? loadTokens;
  const save = deps.save ?? saveTokens;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const existing = await load(provider.id);

  if (existing && !isExpired(existing, now())) return existing.access;
  if (provider.auth === "oauth-copilot" && existing?.refresh) {
    // Copilot's refresh token is the GitHub token itself; it does not rotate.
    const refreshed = await copilotRefresh(existing.refresh, fetchImpl);
    await save(provider.id, refreshed);
    return refreshed.access;
  }
  if (!existing?.refresh) {
    throw new Error(
      `${provider.name} is not connected. Connect it in Settings → Subscriptions.`,
    );
  }

  const key = provider.id;
  const running = inflight.get(key);
  if (running) return running;

  const job = (async () => {
    const refreshed = await claudeRefresh(existing.refresh, fetchImpl);
    await save(key, refreshed);
    return refreshed.access;
  })();
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

/** Headers an OAuth provider's request needs, on top of Content-Type. */
export function applyOAuthHeaders(auth: NonNullable<Provider["auth"]>, access: string): Record<string, string> {
  if (auth === "oauth-claude") {
    // Subscription calls are Bearer-authenticated and gated on the OAuth beta.
    return {
      Authorization: `Bearer ${access}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
    };
  }
  return {
    Authorization: `Bearer ${access}`,
    "Editor-Version": COPILOT_EDITOR_VERSION,
    "Editor-Plugin-Version": COPILOT_PLUGIN_VERSION,
  };
}
