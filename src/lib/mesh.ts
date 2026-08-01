import { invoke } from "@tauri-apps/api/core";
import type { Provider, Settings, Tool } from "./types";

/**
 * Device mesh — the frontend half.
 *
 * Rust owns the wire (discovery, the WebSocket, pairing proofs). This owns the
 * *policy*: what this device is willing to do for another, and what happens to
 * an inbound request once it arrives. That split matters — Rust has no idea what
 * a tool or a model is, so it can't accidentally expose one.
 *
 * The sharing rules default to off. Pairing a device grants nothing on its own;
 * each capability is a separate, explicit switch.
 */

export interface MeshShare {
  /** Let paired devices run this machine's models. The GPU-box case. */
  models: boolean;
  /** Let them call tools here — file access, shell, MCP servers. */
  tools: boolean;
  /** Let them search this machine's knowledge bases. */
  knowledge: boolean;
}

export const NO_SHARING: MeshShare = { models: false, tools: false, knowledge: false };

export interface MeshPeer {
  id: string;
  name: string;
  addr: string;
  paired: boolean;
  online: boolean;
  seen: number;
  capabilities: PeerCapabilities | null;
  /** Where this peer's address lives, judged by Rust from the address itself. */
  exposure?: Exposure;
}

export interface PeerCapabilities {
  name: string;
  version: number;
  /** Models this device offers, as "providerName / model". */
  models: string[];
  /** Tool ids it will run. */
  tools: string[];
  knowledge: string[];
  share: MeshShare;
}

export interface MeshStatus {
  running: boolean;
  id: string;
  name: string;
  port: number;
  discoveryPort: number;
  pairing: { expires: number } | null;
  peers: MeshPeer[];
  /**
   * Set once something from off the LAN has connected to this device — i.e. the
   * port really is reachable from the internet, not merely might be.
   */
  exposure: {
    from: string;
    class: string;
    at: number;
    count: number;
    authenticated: boolean;
  } | null;
}

export const CAPABILITY_VERSION = 1;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

const ID_KEY = "hs-device-id";
const NAME_KEY = "hs-device-name";

/**
 * This device's stable id. Generated once and kept: peers store it alongside
 * the token they issued us, so losing it means re-pairing everywhere.
 */
export function deviceId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = randomHex(16);
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function deviceName(): string {
  return localStorage.getItem(NAME_KEY) || defaultDeviceName();
}

export function setDeviceName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim() || defaultDeviceName());
}

function defaultDeviceName(): string {
  // The browser won't tell us the hostname, so the platform is the best guess
  // available — the user renames it once and it sticks.
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Mac OS/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux PC";
  return "This device";
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Pairing codes
// ---------------------------------------------------------------------------

/**
 * Alphabet without the characters people mistype when reading a code off one
 * screen and into another: no 0/O, no 1/I/L, no 5/S, no 8/B.
 */
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY234679";

/** A code like `KMEN-7RQT-VDXA` — 12 characters, ~56 bits. */
export function newPairingCode(): string {
  const chars: string[] = [];
  // Rejection sampling rather than `% length`: the modulo would make the first
  // few letters of the alphabet slightly likelier, and a pairing code is the
  // only thing standing between a stranger on the network and a paired device.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (chars.length < 12) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit || chars.length >= 12) continue;
      chars.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    }
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((g) => g.join(""))
    .join("-");
}

/**
 * What the user typed, in the form the other device hashed.
 *
 * Both ends must normalise identically or the proof simply won't match, with no
 * clue as to why — so this strips everything that isn't a code character and
 * upper-cases, letting people paste with spaces, lowercase or missing dashes.
 */
export function normalizePairingCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.replace(/(.{4})(?=.)/g, "$1-");
}

/** Is this plausibly a full code? Used to enable the Pair button. */
export function looksLikeCode(input: string): boolean {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").length >= 12;
}

// ---------------------------------------------------------------------------
// Where an address lives
// ---------------------------------------------------------------------------

/**
 * How exposed a peer address is.
 *
 * This matters because mesh traffic isn't encrypted yet. On a home LAN that's
 * the same exposure as any other local service; over the open internet it means
 * anyone on the path can read the prompts, the tool output and the knowledge
 * that goes across. So the app has to be able to tell the difference and say so.
 *
 *   loopback  same machine
 *   private   RFC1918 / link-local / IPv6 ULA — a LAN
 *   vpn       100.64.0.0/10, the range Tailscale and other overlays use
 *   public    routable on the internet
 *   unknown   a hostname; we can't resolve it here, so we can't judge it
 */
export type Exposure = "loopback" | "private" | "vpn" | "public" | "unknown";

/** Strip any port and brackets, leaving the host. */
export function hostOf(addr: string): string {
  const s = addr.trim().replace(/^\w+:\/\//, "");
  const bracketed = s.match(/^\[([^\]]+)\]/);
  if (bracketed) return bracketed[1];
  // An IPv6 literal without brackets has several colons; a host:port has one.
  const parts = s.split(":");
  return parts.length > 2 ? s : parts[0];
}

export function addressExposure(addr: string): Exposure {
  const host = hostOf(addr).toLowerCase();
  if (!host) return "unknown";
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) return "loopback";

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1, 3).map(Number);
    if (v4.slice(1).map(Number).some((n) => n > 255)) return "unknown";
    if (a === 10) return "private";
    if (a === 192 && b === 168) return "private";
    if (a === 172 && b >= 16 && b <= 31) return "private";
    if (a === 169 && b === 254) return "private"; // link-local
    // Carrier-grade NAT. Tailscale hands out addresses here, and so does some
    // mobile carrier equipment — either way it isn't the open internet.
    if (a === 100 && b >= 64 && b <= 127) return "vpn";
    return "public";
  }

  if (host.includes(":")) {
    if (host.startsWith("fe80")) return "private"; // link-local
    // fc00::/7 — unique local addresses.
    if (/^f[cd]/.test(host)) return "private";
    return "public";
  }

  // A hostname. `desk.local` is mDNS and therefore a LAN, but anything else
  // could resolve anywhere, and guessing wrong in the reassuring direction is
  // the one mistake worth avoiding.
  if (host.endsWith(".local") || !host.includes(".")) return "private";
  return "unknown";
}

/** Should the user be warned before sending unencrypted traffic here? */
export function needsWarning(exposure: Exposure): boolean {
  return exposure === "public" || exposure === "unknown";
}

export function exposureNote(exposure: Exposure, what = "That address"): string | null {
  switch (exposure) {
    case "public":
      return `${what} is on the public internet. Mesh traffic isn't encrypted yet, so anything you send across it — prompts, tool output, knowledge — can be read on the way. Put the link inside a VPN or tunnel (Tailscale, WireGuard, SSH) instead of connecting directly.`;
    case "unknown":
      return `${what} is a hostname, so there's no telling whether it stays on your network. If it crosses the internet, use a VPN or tunnel — mesh traffic isn't encrypted yet.`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Capability advertisement
// ---------------------------------------------------------------------------

/**
 * What this device tells a peer it can do — filtered by the sharing rules, so a
 * switched-off capability isn't even mentioned.
 */
export function describeSelf(
  settings: Settings,
  tools: Tool[],
  knowledge: string[],
  share: MeshShare,
  name = deviceName(),
): PeerCapabilities {
  const models = share.models
    ? settings.providers.flatMap((p: Provider) =>
        (p.models ?? []).map((m: string) => `${p.name} / ${m}`),
      )
    : [];
  return {
    name,
    version: CAPABILITY_VERSION,
    models,
    // Only tools the user has actually enabled, and never the ones that would
    // hand a remote device a shell on this machine.
    tools: share.tools ? tools.filter(remotelySafe).map((t) => t.id) : [],
    knowledge: share.knowledge ? knowledge : [],
    share,
  };
}

/**
 * Tools that stay local no matter what's shared.
 *
 * Sharing "tools" is meant to mean "use the capabilities of my machine", not
 * "run arbitrary commands on it". A paired device is a device the user owns, but
 * pairing is a code typed once — it shouldn't be a remote shell, and a mistake
 * here is not recoverable.
 */
const NEVER_REMOTE = new Set([
  "run_command",
  "run_shell",
  "python",
  "run_python",
  "write_file",
  "delete_file",
  "fs_remove",
  "fs_write",
]);

export function remotelySafe(tool: Tool): boolean {
  return !NEVER_REMOTE.has(tool.id);
}

// ---------------------------------------------------------------------------
// Inbound requests
// ---------------------------------------------------------------------------

export interface InboundRequest {
  rid: number;
  peerId: string;
  peerName: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Decide whether an inbound request is allowed, before anything runs.
 *
 * Returns null when it's allowed, or the reason to send back. The peer must be
 * one we've paired with *and* the relevant capability must be shared — Rust has
 * already checked the token, this checks intent.
 */
export function authorize(
  req: Pick<InboundRequest, "method" | "peerId">,
  share: MeshShare,
  peers: MeshPeer[],
): string | null {
  const peer = peers.find((p) => p.id === req.peerId);
  if (!peer?.paired) return "this device doesn't recognise you";

  switch (req.method) {
    case "describe":
      // Always answerable: it's how a peer learns there's nothing on offer.
      return null;
    case "ask":
      return share.models ? null : "that device isn't sharing its models";
    case "run_tool":
      return share.tools ? null : "that device isn't sharing its tools";
    case "search_knowledge":
      return share.knowledge ? null : "that device isn't sharing its knowledge";
    default:
      return `unknown request "${req.method}"`;
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function meshStart(peers: MeshPeer[] = []): Promise<MeshStatus> {
  return invoke("mesh_start", {
    id: deviceId(),
    name: deviceName(),
    peers: peers.map((p) => ({ ...p, capabilities: p.capabilities ?? null })),
  });
}

export async function meshStop(): Promise<void> {
  await invoke("mesh_stop");
}

export async function meshStatus(): Promise<MeshStatus> {
  return invoke("mesh_status");
}

export async function armPairing(code: string, seconds = 300): Promise<{ expires: number }> {
  return invoke("mesh_arm_pairing", { code: normalizePairingCode(code), seconds });
}

export async function disarmPairing(): Promise<void> {
  await invoke("mesh_disarm_pairing");
}

export async function pairWith(addr: string, code: string): Promise<MeshPeer> {
  return invoke("mesh_pair", { addr, code: normalizePairingCode(code) });
}

export async function addPeerByAddress(addr: string, name?: string): Promise<{ id: string }> {
  return invoke("mesh_add_peer", { addr, name });
}

export async function forgetPeer(peerId: string): Promise<void> {
  await invoke("mesh_forget", { peerId });
}

export async function callPeer<T = unknown>(
  peerId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return invoke("mesh_call", { peerId, method, params });
}

export async function replyTo(rid: number, result: unknown, error?: string): Promise<void> {
  await invoke("mesh_reply", { rid, result: error ? null : result, error: error ?? null });
}

export async function exportPeers(): Promise<MeshPeer[]> {
  return invoke("mesh_export_peers");
}
