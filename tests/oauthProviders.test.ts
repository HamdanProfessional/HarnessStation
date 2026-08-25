import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../src/lib/types";

/**
 * Subscription OAuth (lib/oauthProviders). Everything network- and
 * keychain-touching is injected, so the flows, the broker's single-flight
 * refresh, and the header shapes are all tested against fakes.
 */

const mod = await import("../src/lib/oauthProviders");

// ---------- fake fetch / store ----------

type Route = (url: string, init?: RequestInit) => { status: number; json: unknown };

function fetchFrom(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    for (const [needle, route] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const r = route(url, init);
        return { ok: r.status < 400, status: r.status, json: async () => r.json, text: async () => JSON.stringify(r.json) } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as Response;
  });
  return { fetchImpl, calls };
}

function store() {
  const mem = new Map<string, string>();
  return {
    load: async (id: string) => JSON.parse(mem.get(id) ?? "null") ?? null,
    save: async (id: string, t: unknown) => void mem.set(id, JSON.stringify(t)),
    clear: async (id: string) => void mem.delete(id),
    mem,
  };
}

const claudeProvider = (): Provider => ({
  id: "claude-oauth",
  name: "Claude (subscription)",
  kind: "anthropic",
  baseUrl: "https://api.anthropic.com",
  apiKey: "oauth",
  auth: "oauth-claude",
  models: [],
});

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------- PKCE + parsing ----------

describe("pkcePair", () => {
  it("makes a verifier and its S256 challenge, both URL-safe", async () => {
    const { verifier, challenge } = await mod.pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // The challenge really is SHA-256 of the verifier.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const b64 = Buffer.from(digest).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(b64);
  });

  it("two calls never share a verifier", async () => {
    expect((await mod.pkcePair()).verifier).not.toBe((await mod.pkcePair()).verifier);
  });
});

describe("parsePastedCode", () => {
  it("accepts the code#state form the callback page shows", () => {
    expect(mod.parsePastedCode("abc123#st999")).toEqual({ code: "abc123", state: "st999" });
  });
  it("accepts a bare code and a full callback URL", () => {
    expect(mod.parsePastedCode("abc123")).toEqual({ code: "abc123", state: undefined });
    expect(mod.parsePastedCode("https://console.anthropic.com/oauth/code/callback?code=xyz&state=s1")).toEqual({
      code: "xyz",
      state: "s1",
    });
  });
});

describe("claudeAuthorizeUrl", () => {
  it("carries PKCE, scopes and the fixed redirect", () => {
    const u = new URL(mod.claudeAuthorizeUrl("challenge-x", "state-y"));
    expect(u.origin + u.pathname).toBe(mod.CLAUDE_AUTHORIZE_URL);
    expect(u.searchParams.get("client_id")).toBe(mod.CLAUDE_CLIENT_ID);
    expect(u.searchParams.get("code_challenge")).toBe("challenge-x");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toContain("oauth/code/callback");
    expect(u.searchParams.get("scope")).toContain("user:inference");
  });
});

// ---------- Claude token endpoints ----------

describe("claudeExchange / claudeRefresh", () => {
  it("exchanges the code with the verifier and maps the response", async () => {
    const { fetchImpl, calls } = fetchFrom({
      "api/oauth/token": () => ({
        status: 200,
        json: { access_token: "at", refresh_token: "rt", expires_in: 3600 },
      }),
    });
    const t = await mod.claudeExchange("the-code", "the-verifier", fetchImpl);
    expect(t.access).toBe("at");
    expect(t.refresh).toBe("rt");
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({
      grant_type: "authorization_code",
      code: "the-code",
      code_verifier: "the-verifier",
      client_id: mod.CLAUDE_CLIENT_ID,
    });
  });

  it("surfaces a failed exchange with the status", async () => {
    const { fetchImpl } = fetchFrom({ "api/oauth/token": () => ({ status: 400, json: { error: "bad" } }) });
    await expect(mod.claudeExchange("bad", "v", fetchImpl)).rejects.toThrow(/400/);
  });

  it("refreshes with the refresh grant", async () => {
    const { fetchImpl, calls } = fetchFrom({
      "api/oauth/token": () => ({ status: 200, json: { access_token: "at2", refresh_token: "rt2", expires_in: 3600 } }),
    });
    const t = await mod.claudeRefresh("rt", fetchImpl);
    expect(t.access).toBe("at2");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("rt");
  });
});

// ---------- Copilot device flow ----------

describe("copilot device flow", () => {
  it("starts with the client id and returns the user-facing fields", async () => {
    const { fetchImpl, calls } = fetchFrom({
      "login/device/code": () => ({
        status: 200,
        json: { device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 },
      }),
    });
    const s = await mod.copilotDeviceStart(fetchImpl);
    expect(s.userCode).toBe("ABCD-1234");
    expect(JSON.parse(String(calls[0].init?.body)).client_id).toBe(mod.COPILOT_CLIENT_ID);
  });

  it("maps pending, slow_down, success and refusal", async () => {
    const pending = fetchFrom({ "login/oauth": () => ({ status: 200, json: { error: "authorization_pending" } }) });
    await expect(mod.copilotDevicePoll("dc", pending.fetchImpl)).resolves.toEqual({ status: "pending" });

    const slow = fetchFrom({ "login/oauth": () => ({ status: 200, json: { error: "slow_down" } }) });
    await expect(mod.copilotDevicePoll("dc", slow.fetchImpl)).resolves.toEqual({ status: "slow_down" });

    const done = fetchFrom({ "login/oauth": () => ({ status: 200, json: { access_token: "gh1" } }) });
    await expect(mod.copilotDevicePoll("dc", done.fetchImpl)).resolves.toEqual({ status: "done", githubToken: "gh1" });

    const denied = fetchFrom({ "login/oauth": () => ({ status: 200, json: { error: "access_denied", error_description: "no" } }) });
    await expect(mod.copilotDevicePoll("dc", denied.fetchImpl)).resolves.toEqual({ status: "error", message: "no" });
  });

  it("exchanges the GitHub token for the Copilot bearer with the token: scheme", async () => {
    const { fetchImpl, calls } = fetchFrom({
      copilot_internal: () => ({ status: 200, json: { token: "ct", expires_at: 1900000000, user: "octocat" } }),
    });
    const t = await mod.copilotToken("gh1", fetchImpl);
    expect(t).toMatchObject({ token: "ct", account: "octocat" });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("token gh1");
  });
});

// ---------- broker ----------

describe("ensureAccessToken", () => {
  it("returns the stored access token without touching the network while valid", async () => {
    const s = store();
    const fetchImpl = vi.fn();
    await s.save("claude-oauth", { access: "live", refresh: "r", expiresAt: Date.now() + 600_000 });
    const t = await mod.ensureAccessToken(claudeProvider(), { load: s.load, save: s.save, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(t).toBe("live");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes an expired token through the right flow and saves the result", async () => {
    const s = store();
    await s.save("claude-oauth", { access: "old", refresh: "rt", expiresAt: Date.now() - 1000 });
    const { fetchImpl } = fetchFrom({
      "api/oauth/token": () => ({ status: 200, json: { access_token: "new", refresh_token: "rt2", expires_in: 3600 } }),
    });
    const t = await mod.ensureAccessToken(claudeProvider(), { load: s.load, save: s.save, fetchImpl });
    expect(t).toBe("new");
    expect((await s.load("claude-oauth")).access).toBe("new");
  });

  it("a Copilot refresh re-exchanges its GitHub token instead of a refresh grant", async () => {
    const s = store();
    await s.save("copilot-oauth", { access: "stale", refresh: "gh1", expiresAt: Date.now() - 1000 });
    const { fetchImpl } = fetchFrom({
      copilot_internal: () => ({ status: 200, json: { token: "fresh", expires_at: Math.floor(Date.now() / 1000) + 1800, user: "octocat" } }),
    });
    const t = await mod.ensureAccessToken(
      { ...claudeProvider(), id: "copilot-oauth", name: "GitHub Copilot", kind: "openai-compatible", auth: "oauth-copilot" },
      { load: s.load, save: s.save, fetchImpl },
    );
    expect(t).toBe("fresh");
    const saved = await s.load("copilot-oauth");
    expect(saved.refresh).toBe("gh1"); // the GitHub token does not rotate
    expect(saved.account).toBe("octocat");
  });

  it("is single-flight: concurrent callers at expiry share one refresh", async () => {
    const s = store();
    await s.save("claude-oauth", { access: "old", refresh: "rt", expiresAt: Date.now() - 1000 });
    let refreshes = 0;
    const { fetchImpl } = fetchFrom({
      "api/oauth/token": () => {
        refreshes++;
        return { status: 200, json: { access_token: `new-${refreshes}`, refresh_token: "rt2", expires_in: 3600 } };
      },
    });
    const deps = { load: s.load, save: s.save, fetchImpl };
    const [a, b] = await Promise.all([
      mod.ensureAccessToken(claudeProvider(), deps),
      mod.ensureAccessToken(claudeProvider(), deps),
    ]);
    expect(a).toBe(b);
    expect(refreshes).toBe(1);
  });

  it("says where to connect when there are no tokens at all", async () => {
    const s = store();
    const { fetchImpl } = fetchFrom({});
    await expect(
      mod.ensureAccessToken(claudeProvider(), { load: s.load, save: s.save, fetchImpl }),
    ).rejects.toThrow(/Settings → Subscriptions/);
  });
});

// ---------- headers ----------

describe("applyOAuthHeaders", () => {
  it("Claude: Bearer + OAuth beta flag, never x-api-key", () => {
    const h = mod.applyOAuthHeaders("oauth-claude", "tok");
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["anthropic-beta"]).toContain("oauth");
    expect(h["x-api-key"]).toBeUndefined();
  });

  it("Copilot: Bearer plus the editor identity headers", () => {
    const h = mod.applyOAuthHeaders("oauth-copilot", "tok");
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["Editor-Version"]).toContain("vscode");
    expect(h["Editor-Plugin-Version"]).toContain("copilot");
  });
});

describe("connectedStatus", () => {
  it("distinguishes not-connected, valid and expired", async () => {
    const s = store();
    const deps = { load: s.load };
    await expect(mod.connectedStatus("p", deps)).resolves.toBe("not-connected");
    await s.save("p", { access: "a", refresh: "r", expiresAt: Date.now() + 600_000 });
    await expect(mod.connectedStatus("p", deps)).resolves.toBe("valid");
    await s.save("p", { access: "a", refresh: "r", expiresAt: Date.now() - 600_000 });
    await expect(mod.connectedStatus("p", deps)).resolves.toBe("expired");
  });
});
