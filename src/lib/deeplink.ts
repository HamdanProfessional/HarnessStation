/**
 * Deep links: a chat's setup encoded in the page URL.
 *
 * Two jobs:
 *   1. Reading — on boot, apply `?provider=…&model=…&style=…&mode=…` (and,
 *      optionally, a shared key) so a link opens the app already configured.
 *   2. Writing — keep the address bar mirroring the current selection, and
 *      build a shareable link from a chat on demand.
 *
 * This is a convenience for demos and onboarding: send someone a link and they
 * land on the right provider/model without touching Settings. Two ways to carry
 * credentials so a recipient can try the app with no key of their own:
 *
 *   • `?key=…`      — the raw API key in the URL. Convenient, but the key is
 *                     visible to anyone who sees the link and lands in browser
 *                     history, so we warn and strip it from the bar after use.
 *   • `?trial=CODE` — a short code the gateway resolves to a pre-registered
 *                     provider (key included) server-side, so the key never
 *                     appears in the link. Preferred for anything you share.
 *
 * Only meaningful in the web build (the desktop app has an opaque tauri:// URL),
 * but the read/apply path is harmless if it ever runs elsewhere.
 */
import { gatewayUrl } from "./gateway";
import { useStore } from "./store";
import { STYLE_PRESETS } from "./styles";
import { toast } from "./toast";
import type { Provider, ProviderKind, Settings } from "./types";

const STYLE_IDS = new Set(STYLE_PRESETS.map((s) => s.id));

export interface DeepLinkConfig {
  provider?: string; // provider id, or name (case-insensitive) as a fallback
  model?: string;
  style?: string; // normal | concise | explanatory | formal
  mode?: "chat" | "voice";
  system?: string; // custom system prompt for this chat
  key?: string; // API key to apply to the target provider (insecure — warned)
  trial?: string; // gateway trial code that resolves to a full provider bundle
}

/** True when running the browser build, where the page URL is real and shareable. */
export function isWeb(): boolean {
  return !!(globalThis as unknown as { __HS_WEB__?: boolean }).__HS_WEB__;
}

/** True when the page URL carries a deep-link config — used to skip onboarding. */
export function hasDeepLink(search = typeof location !== "undefined" ? location.search : ""): boolean {
  return readDeepLink(search) !== null;
}

/** Read a deep-link config from a query string (defaults to the live URL). */
export function readDeepLink(search = typeof location !== "undefined" ? location.search : ""): DeepLinkConfig | null {
  const q = new URLSearchParams(search);
  const cfg: DeepLinkConfig = {};
  const provider = q.get("provider") ?? q.get("p");
  const model = q.get("model") ?? q.get("m");
  const style = q.get("style") ?? q.get("s");
  const mode = q.get("mode");
  const system = q.get("system");
  const key = q.get("key") ?? q.get("apikey") ?? q.get("api");
  const trial = q.get("trial") ?? q.get("code");
  if (provider) cfg.provider = provider;
  if (model) cfg.model = model;
  if (style && STYLE_IDS.has(style)) cfg.style = style;
  if (mode === "voice" || mode === "chat") cfg.mode = mode;
  if (system) cfg.system = system;
  if (key) cfg.key = key;
  if (trial) cfg.trial = trial;
  return Object.keys(cfg).length ? cfg : null;
}

/** A provider bundle the gateway hands back for a trial code. */
interface TrialBundle {
  id?: string;
  name: string;
  kind?: ProviderKind;
  baseUrl: string;
  apiKey?: string;
  models?: string[];
  note?: string;
}

/**
 * Resolve a trial code to a provider via the gateway and add it to Settings.
 * Returns the provider id that was upserted, or null if it couldn't be fetched.
 */
async function redeemTrial(code: string): Promise<string | null> {
  const base = gatewayUrl();
  if (!base) {
    toast.error("This build has no gateway configured, so trial links can't be redeemed.");
    return null;
  }
  let bundle: TrialBundle;
  try {
    const res = await fetch(`${base}/api/trial/${encodeURIComponent(code)}`);
    if (res.status === 404) {
      toast.error("That trial link isn't valid (unknown code).");
      return null;
    }
    if (res.status === 410) {
      toast.error("That trial link has expired.");
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bundle = (await res.json()) as TrialBundle;
  } catch (e) {
    toast.error(`Couldn't redeem the trial link: ${(e as Error).message}`);
    return null;
  }
  if (!bundle?.baseUrl || !bundle?.name) return null;

  const id = bundle.id || `trial-${code}`;
  const provider: Provider = {
    id,
    name: bundle.name,
    kind: bundle.kind ?? "openai-compatible",
    baseUrl: bundle.baseUrl,
    apiKey: bundle.apiKey ?? "",
    models: bundle.models ?? [],
  };
  const settings = structuredClone(useStore.getState().settings);
  const at = settings.providers.findIndex((p) => p.id === id);
  if (at >= 0) settings.providers[at] = { ...settings.providers[at], ...provider };
  else settings.providers.unshift(provider);
  await useStore.getState().saveSettings(settings);
  toast.success(`Trial provider "${bundle.name}" is ready${bundle.note ? ` — ${bundle.note}` : ""}.`);
  return id;
}

/** Find a provider by id first, then by a case-insensitive name match. */
function resolveProvider(settings: Settings, ref: string): Provider | undefined {
  return (
    settings.providers.find((p) => p.id === ref) ??
    settings.providers.find((p) => p.name.toLowerCase() === ref.toLowerCase())
  );
}

/**
 * Add a known cloud provider (from the catalog) that the link named but which
 * isn't set up yet — e.g. `?provider=groq`. Returns its id, or null if it isn't
 * a provider we recognise. The key is still the user's to add.
 */
async function provisionKnownProvider(ref: string, model?: string): Promise<string | null> {
  const { CLOUD_PROVIDERS } = await import("./catalog");
  const key = ref.toLowerCase();
  const known = CLOUD_PROVIDERS.find((c) => c.id === key || c.name.toLowerCase() === key);
  if (!known) return null;
  const settings = structuredClone(useStore.getState().settings);
  if (!settings.providers.some((p) => p.id === known.id)) {
    // Keep the model the link asked for even if it's newer than our catalog list.
    const models = model && !known.models.includes(model) ? [model, ...known.models] : known.models;
    settings.providers.unshift({
      id: known.id,
      name: known.name,
      kind: known.kind,
      baseUrl: known.baseUrl,
      apiKey: "",
      models,
    });
    await useStore.getState().saveSettings(settings);
    toast.success(`Added the ${known.name} provider. Paste your API key to start — Settings → Providers, or add &key=… to the link.`);
  }
  return known.id;
}

/**
 * Apply a deep-link config: redeem any trial, inject a shared key, then point
 * the current chat at the chosen provider/model/style. Called once after boot.
 */
export async function applyDeepLink(cfg: DeepLinkConfig): Promise<void> {
  const store = useStore.getState();

  // 1. A trial code brings its own provider (and usually its key).
  let targetProviderId: string | undefined;
  if (cfg.trial) {
    targetProviderId = (await redeemTrial(cfg.trial)) ?? undefined;
  }

  // 2. Otherwise the provider is named directly. If it isn't set up yet but it's
  //    a provider we know (Groq, OpenRouter, Gemini…), add it from the catalog so
  //    the link works on a fresh install — the user just needs to supply the key.
  if (!targetProviderId && cfg.provider) {
    const p = resolveProvider(useStore.getState().settings, cfg.provider);
    if (p) targetProviderId = p.id;
    else targetProviderId = (await provisionKnownProvider(cfg.provider, cfg.model)) ?? undefined;
    if (!targetProviderId) {
      toast.error(`No provider "${cfg.provider}" is set up, and it isn't one I can add automatically. Add it under Settings → Providers.`);
    }
  }

  // 3. A raw key in the link is applied to that provider — and flagged, since a
  //    key in a URL is visible to anyone the link reaches.
  if (cfg.key && targetProviderId) {
    const settings = structuredClone(useStore.getState().settings);
    const p = settings.providers.find((x) => x.id === targetProviderId);
    if (p) {
      p.apiKey = cfg.key;
      await useStore.getState().saveSettings(settings);
      toast.info("An API key from the link was added to this provider. Keys in a URL are visible to anyone who has the link.");
    }
  }

  // 4. Point the current chat at the resulting setup.
  const settings = useStore.getState().settings;
  const patch: Record<string, unknown> = {};
  if (targetProviderId) {
    const p = settings.providers.find((x) => x.id === targetProviderId);
    patch.providerId = targetProviderId;
    // Prefer the requested model, else keep a valid one for this provider.
    patch.model = cfg.model && (!p || !p.models.length || p.models.includes(cfg.model))
      ? cfg.model
      : p?.models[0] ?? cfg.model ?? "";
  } else if (cfg.model) {
    patch.model = cfg.model;
  }
  if (cfg.style) patch.styleId = cfg.style;
  if (cfg.system) patch.systemPrompt = cfg.system;
  if (Object.keys(patch).length) store.updateChat(patch);

  // 5. Voice links open the avatar straight away.
  if (cfg.mode === "voice") store.setView("voice");
}

/**
 * Params that mirror the current chat's selection in the address bar. Only the
 * non-sensitive setup (provider/model/style/mode) — never the key.
 */
function currentParams(): URLSearchParams {
  const q = new URLSearchParams();
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === s.currentId);
  if (!chat) return q;
  if (chat.providerId) q.set("provider", chat.providerId);
  if (chat.model) q.set("model", chat.model);
  if (chat.styleId && chat.styleId !== "normal") q.set("style", chat.styleId);
  if (chat.kind === "voice" || s.view === "voice") q.set("mode", "voice");
  return q;
}

/**
 * Keep the URL reflecting the current chat, without adding a history entry.
 * A no-op off the web build. Returns an unsubscribe.
 */
export function startUrlSync(): () => void {
  if (!isWeb()) return () => {};
  const write = () => {
    const q = currentParams();
    const qs = q.toString();
    const next = qs ? `${location.pathname}?${qs}` : location.pathname;
    if (next !== location.pathname + location.search) {
      history.replaceState(history.state, "", next);
    }
  };
  write();
  return useStore.subscribe(write);
}

/** Build a shareable link for a chat's current setup. */
export function buildShareLink(opts: { includeKey?: boolean; includeSystem?: boolean } = {}): string {
  const origin = typeof location !== "undefined" ? location.origin + location.pathname : "https://hsapp.retris.io/";
  const s = useStore.getState();
  const chat = s.chats.find((c) => c.id === s.currentId);
  const q = new URLSearchParams();
  if (chat) {
    if (chat.providerId) q.set("provider", chat.providerId);
    if (chat.model) q.set("model", chat.model);
    if (chat.styleId && chat.styleId !== "normal") q.set("style", chat.styleId);
    if (chat.kind === "voice") q.set("mode", "voice");
    if (opts.includeSystem && chat.systemPrompt.trim()) q.set("system", chat.systemPrompt.trim());
    if (opts.includeKey) {
      const p = s.settings.providers.find((x) => x.id === chat.providerId);
      if (p?.apiKey) q.set("key", p.apiKey);
    }
  }
  const qs = q.toString();
  return qs ? `${origin}?${qs}` : origin;
}
