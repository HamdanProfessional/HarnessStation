/**
 * Opt-in cloud sync — zero-knowledge, end-to-end encrypted.
 *
 * The account password never leaves the device. From it we derive two things:
 *   - an *auth verifier* (sent to the gateway to sign in), and
 *   - an AES-GCM *encryption key* (never sent) that encrypts the data blob.
 * The gateway stores only a verifier hash and ciphertext — it can never read
 * your data. **API keys and the secrets vault are excluded from the blob**, so
 * they stay on the device; you re-enter them once per machine.
 *
 * The derived key is cached in the device secret store (keychain / localStorage)
 * so sync survives a restart without re-typing the password — the *server* is
 * still zero-knowledge; only this device holds the key.
 */
import { fetch } from "@tauri-apps/plugin-http";
import { gatewayUrl } from "./gateway";
import { useStore } from "./store";
import { gatherSyncSnapshot, applySyncSnapshot, type SyncSnapshot } from "./storage";

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const ITERATIONS = 200_000;

// ---- small binary helpers (stack-safe base64) ----
function b64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function unb64(str: string): Uint8Array {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function cat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const o = new Uint8Array(a.length + b.length);
  o.set(a);
  o.set(b, a.length);
  return o;
}

// ---- crypto ----

export interface DerivedKeys {
  authVerifier: string; // hex, sent to the server
  encKey: CryptoKey; // AES-GCM, never sent
}

/** Derive the auth verifier + encryption key from an email + password. Pure. */
export async function deriveKeys(email: string, password: string): Promise<DerivedKeys> {
  const salt = ENC.encode(`harnessstation-sync-v1:${email.trim().toLowerCase()}`);
  const base = await subtle().importKey("raw", ENC.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
  const authBits = await subtle().deriveBits(
    { name: "PBKDF2", salt: cat(salt, ENC.encode("\x01auth")), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    256,
  );
  const encKey = await subtle().deriveKey(
    { name: "PBKDF2", salt: cat(salt, ENC.encode("\x02enc")), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  return { authVerifier: hex(authBits), encKey };
}

/** Encrypt a string to `base64(iv):base64(ciphertext)`. */
export async function encrypt(encKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, encKey, ENC.encode(plaintext));
  return `${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

/** Decrypt a `base64(iv):base64(ciphertext)` blob back to a string. */
export async function decrypt(encKey: CryptoKey, blob: string): Promise<string> {
  const [ivB, ctB] = blob.split(":");
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: unb64(ivB) }, encKey, unb64(ctB));
  return DEC.decode(pt);
}

// ---- device key cache (in the secret store) ----

const KEY_ID = "sync:enckey";
let sessionKey: CryptoKey | null = null;

async function secretSet(id: string, value: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("secret_set", { id, value }).catch(() => {});
}
async function secretGet(id: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("secret_get", { id });
  } catch {
    return null;
  }
}

async function cacheKey(encKey: CryptoKey) {
  sessionKey = encKey;
  const raw = new Uint8Array(await subtle().exportKey("raw", encKey));
  await secretSet(KEY_ID, b64(raw));
}
async function loadKey(): Promise<CryptoKey | null> {
  if (sessionKey) return sessionKey;
  const raw = await secretGet(KEY_ID);
  if (!raw) return null;
  sessionKey = await subtle().importKey("raw", unb64(raw), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return sessionKey;
}
async function clearKey() {
  sessionKey = null;
  await secretSet(KEY_ID, "");
}

// ---- gateway API ----

async function api<T>(path: string, init?: RequestInit & { token?: string }): Promise<T | null> {
  const base = gatewayUrl();
  if (!base) throw new Error("Cloud sync needs the HarnessStation gateway, which isn't configured in this build.");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) };
  if (init?.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (res.status === 204) return null;
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* non-JSON */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function cloudAvailable(): boolean {
  return !!gatewayUrl();
}

function setCloud(patch: Partial<NonNullable<import("./types").Settings["cloud"]>>) {
  const s = useStore.getState().settings;
  return useStore.getState().saveSettings({ ...s, cloud: { enabled: false, ...s.cloud, ...patch } });
}

// ---- account ----

export async function signup(email: string, password: string): Promise<void> {
  const { authVerifier, encKey } = await deriveKeys(email, password);
  const r = await api<{ token: string }>(`/api/account/signup`, {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), authVerifier }),
  });
  await cacheKey(encKey);
  await setCloud({ enabled: true, email: email.trim().toLowerCase(), token: r!.token, autoSync: true });
}

/** Log in. Returns whether the account already has a stored blob to pull. */
export async function login(email: string, password: string): Promise<{ hasBlob: boolean }> {
  const { authVerifier, encKey } = await deriveKeys(email, password);
  const r = await api<{ token: string; hasBlob: boolean }>(`/api/account/login`, {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), authVerifier }),
  });
  await cacheKey(encKey);
  await setCloud({ enabled: true, email: email.trim().toLowerCase(), token: r!.token, autoSync: true });
  return { hasBlob: !!r!.hasBlob };
}

export async function logout(): Promise<void> {
  const token = useStore.getState().settings.cloud?.token;
  if (token) await api(`/api/account/logout`, { method: "POST", token }).catch(() => {});
  await clearKey();
  const s = useStore.getState().settings;
  await useStore.getState().saveSettings({ ...s, cloud: { enabled: false } });
}

export async function deleteAccount(): Promise<void> {
  const token = useStore.getState().settings.cloud?.token;
  if (token) await api(`/api/account`, { method: "DELETE", token });
  await clearKey();
  const s = useStore.getState().settings;
  await useStore.getState().saveSettings({ ...s, cloud: { enabled: false } });
}

// ---- sync ----

let syncing = false;

export async function isReady(): Promise<boolean> {
  return !!useStore.getState().settings.cloud?.token && !!(await loadKey());
}

/** Encrypt the local snapshot and upload it. */
export async function pushNow(): Promise<void> {
  const cloud = useStore.getState().settings.cloud;
  const key = await loadKey();
  if (!cloud?.token || !key || syncing) return;
  syncing = true;
  try {
    const snapshot = await gatherSyncSnapshot();
    const blob = await encrypt(key, JSON.stringify(snapshot));
    const r = await api<{ updatedAt: number; version: number }>(`/api/sync`, {
      method: "PUT",
      token: cloud.token,
      body: JSON.stringify({ blob, version: cloud.version ?? 0 }),
    });
    await setCloud({ lastSyncedAt: r!.updatedAt, version: r!.version });
  } finally {
    syncing = false;
  }
}

/** Download, decrypt and apply the cloud snapshot. Returns true if something was applied. */
export async function pullNow(): Promise<boolean> {
  const cloud = useStore.getState().settings.cloud;
  const key = await loadKey();
  if (!cloud?.token || !key || syncing) return false;
  syncing = true;
  try {
    const r = await api<{ blob: string; updatedAt: number; version: number }>(`/api/sync`, { token: cloud.token });
    if (!r) return false; // 204 — nothing stored yet
    const snapshot = JSON.parse(await decrypt(key, r.blob)) as SyncSnapshot;
    await applySyncSnapshot(snapshot);
    await setCloud({ lastSyncedAt: r.updatedAt, version: r.version });
    await useStore.getState().init(); // reload the UI from the freshly written data
    return true;
  } finally {
    syncing = false;
  }
}

// ---- auto-sync ----

let debounce: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;

/** Push after local changes settle (debounced), while auto-sync is on. Idempotent. */
export function startAutoSync(): void {
  if (unsub) return;
  unsub = useStore.subscribe(() => {
    const cloud = useStore.getState().settings.cloud;
    if (!cloud?.enabled || !cloud.autoSync || !cloud.token) return;
    if (useStore.getState().streaming) return; // don't sync mid-generation
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => void pushNow().catch(() => {}), 8000);
  });
}

export function stopAutoSync(): void {
  if (debounce) clearTimeout(debounce);
  unsub?.();
  unsub = null;
}
