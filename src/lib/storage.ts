import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Agent, Chat, KnowledgeBase, Preset, Schedule, Settings, Template, Tool, ToolSet, Workflow } from "./types";

const ROOT = ".harnessx";
const CONV = `${ROOT}/conversations`;
const PRESETS = `${ROOT}/presets`;
const opts = { baseDir: BaseDirectory.Home };

export const ESSENTIALS_PROFILE_ID = "essentials";

/**
 * Views hidden on a fresh install.
 *
 * A first-run sidebar with fourteen destinations reads as "I don't know what
 * this is for". Three reads as confidence. Everything here still exists, still
 * works and is one click away — the profile only controls what a *new* user is
 * shown before they've asked for more.
 *
 * What survives: Discover (how you connect a model), My Models, and Tools —
 * the minimum that makes the pitch true. Chat and Settings are not views and
 * are always present.
 *
 * Ids are checked against the view registry by a test, so a rename can't turn
 * one of these into a silent no-op.
 */
export const ESSENTIALS_HIDDEN = [
  "compare",
  "evals",
  "benchmarks",
  "agents",
  "skills",
  "knowledge",
  "workflows",
  "schedules",
  "mcp",
  "community",
  "files",
  // Needs the `claude` CLI installed separately, and only means anything once
  // you have agents or skills worth injecting — both of which live in views
  // that are themselves hidden here.
  "claudecode",
  // Means nothing until an ACP agent is configured in Settings, which itself
  // presumes the user knows what the ACP registry is.
  "acp",
] as const;

export const DEFAULT_SETTINGS: Settings = {
  providers: [
    {
      // Default local provider: llama.cpp's `llama-server` speaks the OpenAI API
      // at :8080/v1. First in the list, so a fresh install points here out of the
      // box — run `llama-server -m model.gguf` and it just works, no key.
      id: "llamacpp",
      name: "llama.cpp (local)",
      kind: "openai-compatible",
      baseUrl: "http://localhost:8080/v1",
      apiKey: "",
      models: [],
    },
    {
      id: "lmstudio",
      name: "LM Studio (local)",
      kind: "openai-compatible",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "",
      models: [],
    },
    {
      id: "ollama",
      name: "Ollama (local)",
      kind: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      models: [],
    },
    {
      id: "openai",
      name: "OpenAI",
      kind: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      models: ["gpt-4o", "gpt-4o-mini"],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      kind: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: "",
      models: ["claude-sonnet-5", "claude-haiku-4-5-20251001"],
    },
  ],
  globalInstructions: "",
  theme: "dark",
  accent: "indigo",
  serverUrl: "",
  aaApiKey: "",
  autoCompact: false,
  compactThreshold: 8000,
  profiles: [{ id: ESSENTIALS_PROFILE_ID, name: "Essentials", hiddenViews: [...ESSENTIALS_HIDDEN] }],
  activeProfileId: ESSENTIALS_PROFILE_ID,
};

// Checked once per session rather than on every read/write — these directories
// don't disappear underneath us, and saveChat runs on a hot path.
let dirsReady: Promise<void> | null = null;

function ensureDirs(): Promise<void> {
  dirsReady ??= (async () => {
    if (!(await exists(CONV, opts))) await mkdir(CONV, { ...opts, recursive: true });
    if (!(await exists(PRESETS, opts))) await mkdir(PRESETS, { ...opts, recursive: true });
  })().catch((e) => {
    dirsReady = null; // let the next call retry rather than caching the failure
    throw e;
  });
  return dirsReady;
}

export async function loadPresets(): Promise<Preset[]> {
  await ensureDirs();
  const entries = await readDir(PRESETS, opts);
  const presets: Preset[] = [];
  for (const e of entries) {
    if (!e.name?.endsWith(".json")) continue;
    try {
      presets.push(JSON.parse(await readTextFile(`${PRESETS}/${e.name}`, opts)));
    } catch {
      /* skip corrupt file */
    }
  }
  presets.sort((a, b) => a.name.localeCompare(b.name));
  return presets;
}

export async function savePreset(preset: Preset): Promise<void> {
  await ensureDirs();
  await writeTextFile(`${PRESETS}/${preset.id}.json`, JSON.stringify(preset, null, 2), opts);
}

export async function deletePreset(id: string): Promise<void> {
  try {
    await remove(`${PRESETS}/${id}.json`, opts);
  } catch {
    /* already gone */
  }
}

async function getSecret(id: string): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string | null>("secret_get", { id });
  } catch {
    return null;
  }
}

async function setSecret(id: string, value: string): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("secret_set", { id, value });
  } catch {
    /* keychain unavailable — key stays in settings.json as fallback */
  }
}

// ---------- user secrets vault ----------
// Values live in the same keychain as provider keys, under a `vault:` namespace,
// so they never touch settings.json or a chat transcript. Only metadata (name,
// description) is persisted in Settings.

export const vaultGet = (ref: string) => getSecret(`vault:${ref}`);
export const vaultSet = (ref: string, value: string) => setSecret(`vault:${ref}`, value);
export const vaultDelete = (ref: string) => setSecret(`vault:${ref}`, "");

// ---------- subscription OAuth tokens ----------
// Same keychain, `oauth:` namespace. A provider's settings entry carries only
// the marker (`auth: "oauth-claude"`, apiKey "oauth"); the access/refresh
// tokens never touch settings.json. Desktop only — on web the keychain calls
// are unavailable, and so are subscriptions.

export const oauthLoad = async (id: string): Promise<string | null> => getSecret(`oauth:${id}`);
export const oauthSave = (id: string, json: string) => setSecret(`oauth:${id}`, json);
export const oauthClear = (id: string) => setSecret(`oauth:${id}`, "");

export async function loadSettings(): Promise<Settings> {
  await ensureDirs();
  let s: Settings;
  try {
    const raw = await readTextFile(`${ROOT}/settings.json`, opts);
    const saved = JSON.parse(raw) as Partial<Settings>;
    s = { ...DEFAULT_SETTINGS, ...saved };
    // The Essentials profile is a *first-run* default, not a migration. Spreading
    // defaults underneath a saved file would apply it to everyone who upgraded —
    // someone who has been using Workflows for months would open the app to find
    // it gone, which is a bug, not an onboarding improvement. An existing file
    // with no profile chosen means "show me everything", so honour that.
    if (!("activeProfileId" in saved)) s.activeProfileId = undefined;
  } catch {
    return DEFAULT_SETTINGS;
  }
  // Ensure the default local llama.cpp provider exists. Existing installs saved
  // their own `providers` array, which fully replaces the default seed — so a
  // returning user would never get the new entry without this. Prepend it (once)
  // so it becomes their default local provider too.
  let migrated = false;
  if (!s.providers.some((p) => p.id === "llamacpp")) {
    s.providers.unshift(DEFAULT_SETTINGS.providers.find((p) => p.id === "llamacpp")!);
    migrated = true;
  }
  // resolve API keys from the OS keychain; migrate any plaintext keys still in the JSON
  for (const p of s.providers) {
    const stored = await getSecret(`provider:${p.id}`);
    if (stored) p.apiKey = stored;
    else if (p.apiKey) {
      await setSecret(`provider:${p.id}`, p.apiKey);
      migrated = true;
    }
  }
  const aa = await getSecret("aa");
  if (aa) s.aaApiKey = aa;
  else if (s.aaApiKey) {
    await setSecret("aa", s.aaApiKey);
    migrated = true;
  }
  if (migrated) await saveSettings(s); // rewrite JSON with keys blanked
  return s;
}

export async function saveSettings(s: Settings): Promise<void> {
  await ensureDirs();
  // write keys to the keychain, blank them in the on-disk JSON
  const onDisk: Settings = structuredClone(s);
  for (const p of onDisk.providers) {
    await setSecret(`provider:${p.id}`, p.apiKey ?? "");
    p.apiKey = "";
  }
  await setSecret("aa", onDisk.aaApiKey ?? "");
  onDisk.aaApiKey = "";
  await writeTextFile(`${ROOT}/settings.json`, JSON.stringify(onDisk, null, 2), opts);
}

export async function loadChats(): Promise<Chat[]> {
  await ensureDirs();
  const entries = await readDir(CONV, opts);
  // Read in parallel: one round-trip per file, serialised, is the single biggest
  // cost of a cold start once you have a few hundred conversations.
  const results = await Promise.all(
    entries
      .filter((e) => e.name?.endsWith(".json") && e.name !== INDEX_FILE)
      .map(async (e) => {
        try {
          return JSON.parse(await readTextFile(`${CONV}/${e.name}`, opts)) as Chat;
        } catch {
          return null; // skip corrupt file
        }
      }),
  );
  const chats = results.filter((c): c is Chat => c !== null);
  chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return chats;
}

// ---------- chat index (everything but the messages) ----------

/**
 * The sidebar only needs each chat's metadata, but the transcripts are the bulk
 * of the data — especially with base64 image attachments. So the metadata lives
 * in one small index file and message bodies load when a chat is opened.
 *
 * The index is a cache, never the source of truth: it is rebuilt from the
 * conversation files whenever it's missing, unreadable, or out of step with
 * what's actually on disk.
 */
const INDEX_FILE = "index.json";
const INDEX_PATH = `${CONV}/${INDEX_FILE}`;

export type ChatMeta = Omit<Chat, "messages"> & { messageCount: number };

export function chatMeta(chat: Chat): ChatMeta {
  const { messages, ...rest } = chat;
  return { ...rest, messageCount: messages.length };
}

async function chatIdsOnDisk(): Promise<string[]> {
  const entries = await readDir(CONV, opts);
  return entries
    .filter((e) => e.name?.endsWith(".json") && e.name !== INDEX_FILE)
    .map((e) => e.name!.replace(/\.json$/, ""));
}

async function rebuildIndex(): Promise<ChatMeta[]> {
  const metas = (await loadChats()).map(chatMeta);
  await writeIndex(metas);
  return metas;
}

async function writeIndex(metas: ChatMeta[]): Promise<void> {
  await writeTextFile(INDEX_PATH, JSON.stringify(metas), opts);
}

/** Chat metadata for the sidebar, newest first. Rebuilds the index if it drifted. */
export async function loadChatIndex(): Promise<ChatMeta[]> {
  await ensureDirs();
  let metas: ChatMeta[] | null = null;
  try {
    const raw = JSON.parse(await readTextFile(INDEX_PATH, opts));
    if (Array.isArray(raw)) metas = raw as ChatMeta[];
  } catch {
    /* absent or corrupt — rebuild below */
  }
  if (!metas) return rebuildIndex();

  // Trust it only if it agrees with the files that actually exist.
  const ids = new Set(await chatIdsOnDisk());
  const known = new Set(metas.map((m) => m.id));
  const drifted = ids.size !== known.size || [...ids].some((id) => !known.has(id));
  if (drifted) return rebuildIndex();

  metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return metas;
}

/** Load one chat's full record, or null if the file is gone or unreadable. */
export async function loadChatBody(id: string): Promise<Chat | null> {
  try {
    const chat = JSON.parse(await readTextFile(`${CONV}/${id}.json`, opts)) as Chat;
    return Array.isArray(chat.messages) ? chat : { ...chat, messages: [] };
  } catch {
    return null;
  }
}

async function patchIndex(fn: (metas: ChatMeta[]) => ChatMeta[]): Promise<void> {
  let metas: ChatMeta[] = [];
  try {
    const raw = JSON.parse(await readTextFile(INDEX_PATH, opts));
    if (Array.isArray(raw)) metas = raw as ChatMeta[];
  } catch {
    /* start from empty; a later load will rebuild if this drifts */
  }
  await writeIndex(fn(metas));
}

async function indexUpsert(chat: Chat): Promise<void> {
  const meta = chatMeta(chat);
  await patchIndex((metas) => {
    const i = metas.findIndex((m) => m.id === chat.id);
    if (i === -1) metas.push(meta);
    else metas[i] = meta;
    return metas;
  });
}

async function indexRemove(id: string): Promise<void> {
  await patchIndex((metas) => metas.filter((m) => m.id !== id));
}

export async function saveChat(chat: Chat): Promise<void> {
  await ensureDirs();
  await writeTextFile(`${CONV}/${chat.id}.json`, JSON.stringify(chat, null, 2), opts);
  await indexUpsert(chat);
}

/**
 * Coalesced chat writes.
 *
 * The store patches the chat on every streamed token, and an immediate
 * fire-and-forget saveChat per token meant thousands of full-file rewrites per
 * reply — and, worse, overlapping writes that could land out of order and leave
 * a stale transcript on disk. Writes are now batched per chat and serialised, so
 * at most one write per chat is ever in flight and the newest state wins.
 */
const pendingChats = new Map<string, Chat>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inflightSaves = new Map<string, Promise<void>>();

async function drainChat(id: string): Promise<void> {
  const run = (inflightSaves.get(id) ?? Promise.resolve()).then(async () => {
    const chat = pendingChats.get(id);
    if (!chat) return;
    pendingChats.delete(id);
    await saveChat(chat);
  });
  inflightSaves.set(
    id,
    run.catch(() => {}),
  );
  await run;
}

/** Schedule a save. Safe to call on every keystroke/token. */
export function queueSaveChat(chat: Chat, delayMs = 400): void {
  pendingChats.set(chat.id, chat);
  if (saveTimers.has(chat.id)) return; // a flush is already scheduled
  saveTimers.set(
    chat.id,
    setTimeout(() => {
      saveTimers.delete(chat.id);
      void drainChat(chat.id);
    }, delayMs),
  );
}

/** Forget any queued write for a chat (used when it's being deleted). */
export function cancelChatSave(id: string): void {
  const t = saveTimers.get(id);
  if (t) clearTimeout(t);
  saveTimers.delete(id);
  pendingChats.delete(id);
}

/** Write everything still queued. Call at the end of a turn and before exit. */
export async function flushChatSaves(): Promise<void> {
  for (const [id, t] of saveTimers) {
    clearTimeout(t);
    saveTimers.delete(id);
  }
  const ids = new Set([...pendingChats.keys(), ...inflightSaves.keys()]);
  await Promise.all([...ids].map((id) => drainChat(id).catch(() => {})));
}

// ---------- VRM avatars ----------

const AVATARS = `${ROOT}/avatars`;

export interface AvatarFile {
  /** `name.vrm`, or `folder/model.pmx` for MMD — also the id. */
  file: string;
  /** Display name. */
  name: string;
  kind: "vrm" | "mmd";
  sizeMB: number;
}

const MMD_RE = /\.(pmx|pmd)$/i;

/** Which renderer an avatar id needs. */
export function avatarKind(file: string): "vrm" | "mmd" {
  return MMD_RE.test(file) ? "mmd" : "vrm";
}

/**
 * Imported avatars. A VRM is one self-contained file; an MMD model is a folder
 * of a .pmx plus its textures, so those are listed by the model file inside.
 */
export async function listAvatars(): Promise<AvatarFile[]> {
  try {
    if (!(await exists(AVATARS, opts))) return [];
    const entries = await readDir(AVATARS, opts);
    const out: AvatarFile[] = [];

    for (const e of entries) {
      if (!e.name) continue;

      if (e.isDirectory) {
        // MMD: find the model file inside the extracted folder.
        const model = await findModelFile(`${AVATARS}/${e.name}`);
        if (!model) continue;
        out.push({
          file: `${e.name}/${model}`,
          name: e.name,
          kind: "mmd",
          sizeMB: await sizeOf(`${AVATARS}/${e.name}/${model}`),
        });
        continue;
      }

      if (e.name.toLowerCase().endsWith(".vrm")) {
        out.push({
          file: e.name,
          name: e.name.replace(/\.vrm$/i, ""),
          kind: "vrm",
          sizeMB: await sizeOf(`${AVATARS}/${e.name}`),
        });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return Math.round(((await stat(path, opts)).size ?? 0) / 1e6);
  } catch {
    return 0; // cosmetic
  }
}

/** The .pmx/.pmd inside an extracted MMD folder, searching one level of nesting. */
async function findModelFile(dir: string, depth = 0): Promise<string | null> {
  const entries = await readDir(dir, opts);
  const direct = entries.find((e) => !e.isDirectory && e.name && MMD_RE.test(e.name));
  if (direct) return direct.name!;
  if (depth > 1) return null;
  // Archives usually contain a single wrapper folder.
  for (const e of entries) {
    if (!e.isDirectory || !e.name) continue;
    const nested = await findModelFile(`${dir}/${e.name}`, depth + 1);
    if (nested) return `${e.name}/${nested}`;
  }
  return null;
}

/** Every file in an MMD model's folder, keyed by path relative to that folder. */
export async function readAvatarBundle(file: string): Promise<Map<string, Uint8Array>> {
  const root = `${AVATARS}/${file.split("/").slice(0, -1).join("/")}`;
  const out = new Map<string, Uint8Array>();
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 4) return; // texture folders are shallow; don't chase symlink loops
    for (const e of await readDir(dir, opts)) {
      if (!e.name) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory) await walk(`${dir}/${e.name}`, rel, depth + 1);
      else out.set(rel, await readFile(`${dir}/${e.name}`, opts));
    }
  };
  await walk(root, "", 0);
  return out;
}

/** Copy an imported .vrm into the data folder. Returns the stored file name. */
export async function saveAvatar(fileName: string, bytes: Uint8Array): Promise<string> {
  if (!(await exists(AVATARS, opts))) await mkdir(AVATARS, { ...opts, recursive: true });
  // Keep it a plain file name — this is used to build a path.
  const safe = fileName.replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "");
  const name = safe.toLowerCase().endsWith(".vrm") ? safe : `${safe}.vrm`;
  await writeFile(`${AVATARS}/${name}`, bytes, opts);
  return name;
}

export async function readAvatar(file: string): Promise<Uint8Array> {
  return readFile(`${AVATARS}/${file}`, opts);
}

/**
 * Import a zipped MMD model. Extraction is done in Rust, which already handles
 * archives for the local-model engines. Returns the id of the model inside.
 */
export async function saveAvatarArchive(fileName: string, bytes: Uint8Array): Promise<string> {
  if (!(await exists(AVATARS, opts))) await mkdir(AVATARS, { ...opts, recursive: true });
  const folder =
    fileName
      .replace(/\.zip$/i, "")
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/^\.+/, "")
      .trim() || `mmd-${Date.now()}`;

  const tmp = `${AVATARS}/${folder}.zip`;
  await writeFile(tmp, bytes, opts);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("extract_zip", { zip: `avatars/${folder}.zip`, dest: `avatars/${folder}` });
  try {
    await remove(tmp, opts);
  } catch {
    /* the archive is just clutter at this point */
  }

  const model = await findModelFile(`${AVATARS}/${folder}`);
  if (!model) {
    await deleteAvatar(folder);
    throw new Error("no .pmx or .pmd model found in that archive");
  }
  return `${folder}/${model}`;
}

/** Remove an avatar — a single .vrm, or the whole folder of an MMD model. */
export async function deleteAvatar(file: string): Promise<void> {
  // For MMD the id points at the model inside its folder; drop the folder.
  const target = file.includes("/") ? file.split("/")[0] : file;
  try {
    await remove(`${AVATARS}/${target}`, { ...opts, recursive: true });
  } catch {
    /* already gone */
  }
}

export interface LocalModel {
  publisher: string;
  model: string;
  file: string;
  relPath: string; // relative to ~/.harnessx, e.g. models/pub/repo/file.gguf
  sizeMB: number;
}

const MODELS = `${ROOT}/models`;

/** Scan models/<publisher>/<model>/*.gguf (LM Studio disk convention). */
export async function listLocalModels(): Promise<LocalModel[]> {
  if (!(await exists(MODELS, opts))) return [];
  const found: LocalModel[] = [];
  for (const pub of await readDir(MODELS, opts)) {
    if (!pub.isDirectory || !pub.name) continue;
    for (const repo of await readDir(`${MODELS}/${pub.name}`, opts)) {
      if (!repo.isDirectory || !repo.name) continue;
      for (const f of await readDir(`${MODELS}/${pub.name}/${repo.name}`, opts)) {
        if (!f.name?.toLowerCase().endsWith(".gguf")) continue;
        const rel = `models/${pub.name}/${repo.name}/${f.name}`;
        let sizeMB = 0;
        try {
          sizeMB = Math.round((await stat(`${ROOT}/${rel}`, opts)).size / (1024 * 1024));
        } catch {
          /* size stays 0 */
        }
        found.push({ publisher: pub.name, model: repo.name, file: f.name, relPath: rel, sizeMB });
      }
    }
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

export async function deleteLocalModel(relPath: string): Promise<void> {
  await remove(`${ROOT}/${relPath}`, opts);
}

/** List installed engine folders (engines/llama.cpp-<tag>-<kind>). */
export async function listEngines(): Promise<string[]> {
  const dir = `${ROOT}/engines`;
  if (!(await exists(dir, opts))) return [];
  const entries = await readDir(dir, opts);
  return entries
    .filter((e) => e.isDirectory && e.name)
    .map((e) => `engines/${e.name}`)
    .sort()
    .reverse();
}

// ---------- semantic search vectors ----------

/**
 * Per-chat embeddings for sidebar search, cached next to the conversations
 * they describe. Like the chat index this is a cache, never truth: a stale or
 * missing entry just costs one embed call, and deleting the file is safe.
 * `n` (message count) + `u` (updatedAt) detect changed transcripts.
 */
const VECTORS_PATH = `${CONV}/vectors.json`;

export interface ChatVectorEntry {
  n: number;
  u: string;
  v: number[];
}

export async function loadChatVectors(): Promise<Record<string, ChatVectorEntry>> {
  try {
    const raw = JSON.parse(await readTextFile(VECTORS_PATH, opts));
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, ChatVectorEntry>)
      : {};
  } catch {
    return {};
  }
}

export async function saveChatVectors(map: Record<string, ChatVectorEntry>): Promise<void> {
  try {
    await writeTextFile(VECTORS_PATH, JSON.stringify(map), opts);
  } catch {
    /* a failed cache write only means re-embedding next session */
  }
}

export async function deleteChat(id: string): Promise<void> {
  // Drop anything queued first, or a pending write would recreate the file.
  cancelChatSave(id);
  await inflightSaves.get(id)?.catch(() => {});
  try {
    await remove(`${CONV}/${id}.json`, opts);
  } catch {
    /* already gone */
  }
  await indexRemove(id);
  inflightSaves.delete(id);
}

// ---------- generic JSON collections (tools, workflows, templates) ----------

async function listJson<T>(dir: string): Promise<T[]> {
  const path = `${ROOT}/${dir}`;
  if (!(await exists(path, opts))) return [];
  const items: T[] = [];
  for (const e of await readDir(path, opts)) {
    if (!e.name?.endsWith(".json")) continue;
    try {
      items.push(JSON.parse(await readTextFile(`${path}/${e.name}`, opts)));
    } catch {
      /* skip corrupt */
    }
  }
  return items;
}

async function saveJson(dir: string, id: string, value: unknown): Promise<void> {
  const path = `${ROOT}/${dir}`;
  if (!(await exists(path, opts))) await mkdir(path, { ...opts, recursive: true });
  await writeTextFile(`${path}/${id}.json`, JSON.stringify(value, null, 2), opts);
}

async function removeJson(dir: string, id: string): Promise<void> {
  try {
    await remove(`${ROOT}/${dir}/${id}.json`, opts);
  } catch {
    /* gone */
  }
}

export const listTools = () => listJson<Tool>("tools");
export const saveTool = (t: Tool) => saveJson("tools", t.id, t);
export const deleteTool = (id: string) => removeJson("tools", id);

export const listWorkflows = () => listJson<Workflow>("workflows");
export const saveWorkflow = (w: Workflow) => saveJson("workflows", w.id, w);
export const deleteWorkflow = (id: string) => removeJson("workflows", id);

export const listAgents = () => listJson<Agent>("agents");
export const saveAgent = (a: Agent) => saveJson("agents", a.id, a);
export const deleteAgent = (id: string) => removeJson("agents", id);

export async function loadAgentMemory(agentId: string): Promise<import("./types").MemoryEntry[]> {
  try {
    const raw = await readTextFile(`${ROOT}/agent-memory/${agentId}.json`, opts);
    const parsed = JSON.parse(raw);
    // accept new [MemoryEntry], legacy {entries:[...]}, or plain string[]
    const arr = Array.isArray(parsed) ? parsed : parsed?.entries;
    if (!Array.isArray(arr)) return [];
    return arr.map((e) => (typeof e === "string" ? { text: e, ts: 0 } : e));
  } catch {
    return [];
  }
}

export async function saveAgentMemory(
  agentId: string,
  entries: import("./types").MemoryEntry[],
): Promise<void> {
  const dir = `${ROOT}/agent-memory`;
  if (!(await exists(dir, opts))) await mkdir(dir, { ...opts, recursive: true });
  await writeTextFile(`${dir}/${agentId}.json`, JSON.stringify(entries, null, 2), opts);
}

export const listSchedules = () => listJson<Schedule>("schedules");
export const saveSchedule = (s: Schedule) => saveJson("schedules", s.id, s);
export const deleteSchedule = (id: string) => removeJson("schedules", id);

export const listEvals = () => listJson<import("./types").Eval>("evals");
export const saveEval = (e: import("./types").Eval) => saveJson("evals", e.id, e);
export const deleteEval = (id: string) => removeJson("evals", id);

export const listKnowledgeBases = () => listJson<KnowledgeBase>("knowledge");
export const saveKnowledgeBase = (k: KnowledgeBase) => saveJson("knowledge", k.id, k);
export const deleteKnowledgeBase = (id: string) => removeJson("knowledge", id);

// ---------- full backup / restore ----------

export interface Bundle {
  version: 1;
  exportedAt: string;
  settings: Settings;
  chats: Chat[];
  presets: Preset[];
  templates: Template[];
  tools: Tool[];
  toolSets: ToolSet[];
  workflows: Workflow[];
  agents: Agent[];
  schedules: Schedule[];
  knowledge: KnowledgeBase[];
  mcp: import("./mcp").McpServerConfig[];
}

export async function exportBundle(exportedAt: string): Promise<Bundle> {
  const [
    settings,
    chats,
    presets,
    templates,
    tools,
    toolSets,
    workflows,
    agents,
    schedules,
    knowledge,
    mcp,
  ] = await Promise.all([
    loadSettings(),
    loadChats(),
    loadPresets(),
    listTemplates(),
    listTools(),
    listToolSets(),
    listWorkflows(),
    listAgents(),
    listSchedules(),
    listKnowledgeBases(),
    listMcpServers(),
  ]);
  return {
    version: 1,
    exportedAt,
    settings,
    chats,
    presets,
    templates,
    tools,
    toolSets,
    workflows,
    agents,
    schedules,
    knowledge,
    mcp,
  };
}

export async function importBundle(b: Bundle): Promise<void> {
  if (b.settings) await saveSettings(b.settings);
  for (const c of b.chats ?? []) await saveChat(c);
  for (const p of b.presets ?? []) await savePreset(p);
  for (const t of b.templates ?? []) await saveTemplate(t);
  for (const t of b.tools ?? []) await saveTool(t);
  for (const t of b.toolSets ?? []) await saveToolSet(t);
  for (const w of b.workflows ?? []) await saveWorkflow(w);
  for (const a of b.agents ?? []) await saveAgent(a);
  for (const s of b.schedules ?? []) await saveSchedule(s);
  for (const k of b.knowledge ?? []) await saveKnowledgeBase(k);
  for (const m of b.mcp ?? []) await saveMcpServer(m);
}

// ---------- cloud-sync snapshot ----------
// A superset of Bundle used for cloud sync: adds skills/evals/projects and, on
// the way out, strips API keys so they never leave the device. See src/lib/cloud.ts.

export interface SyncSnapshot {
  version: 2;
  at: string;
  bundle: Bundle; // bundle.settings has all API keys blanked
  skills: { slug: string; markdown: string }[];
  evals: import("./types").Eval[];
  projects: import("./types").Project[];
}

/** Blank every API key and drop the cloud/session block — never synced. */
export function stripSettingsForSync(s: Settings): Settings {
  return {
    ...s,
    providers: s.providers.map((p) => ({ ...p, apiKey: "" })),
    aaApiKey: "",
    cloud: undefined,
  };
}

/** Re-inject this device's own API keys onto incoming settings, so a restore never wipes them. */
export function mergeDeviceKeys(incoming: Settings, device: Settings): Settings {
  const keyById = new Map(device.providers.map((p) => [p.id, p.apiKey]));
  return {
    ...incoming,
    providers: incoming.providers.map((p) => ({ ...p, apiKey: keyById.get(p.id) ?? "" })),
    aaApiKey: device.aaApiKey ?? "",
    cloud: device.cloud, // keep this device's account/session
  };
}

/** Gather everything worth syncing, with keys stripped. */
export async function gatherSyncSnapshot(): Promise<SyncSnapshot> {
  const { listSkills, readSkillRaw } = await import("./skills");
  const bundle = await exportBundle(new Date().toISOString());
  bundle.settings = stripSettingsForSync(bundle.settings);
  const skillList = await listSkills();
  const [skills, evals, projects] = await Promise.all([
    Promise.all(skillList.map(async (s) => ({ slug: s.slug, markdown: await readSkillRaw(s.slug) }))),
    listEvals(),
    listProjects(),
  ]);
  return { version: 2, at: bundle.exportedAt, bundle, skills, evals, projects };
}

/** Apply a pulled snapshot to local storage, preserving this device's keys. */
export async function applySyncSnapshot(snap: SyncSnapshot): Promise<void> {
  const { saveSkill } = await import("./skills");
  const device = await loadSettings();
  await importBundle({ ...snap.bundle, settings: mergeDeviceKeys(snap.bundle.settings, device) });
  for (const sk of snap.skills ?? []) await saveSkill(sk.slug, sk.markdown);
  for (const e of snap.evals ?? []) await saveEval(e);
  for (const p of snap.projects ?? []) await saveProject(p);
}

/** Write a full backup to ~/.harnessx/exports and return its relative path. */
export async function writeBackup(bundle: Bundle, stamp: string): Promise<string> {
  const dir = `${ROOT}/exports`;
  if (!(await exists(dir, opts))) await mkdir(dir, { ...opts, recursive: true });
  const name = `harnessstation-backup-${stamp}.json`;
  await writeTextFile(`${dir}/${name}`, JSON.stringify(bundle, null, 2), opts);
  return `exports/${name}`;
}

export const listMcpServers = () => listJson<import("./mcp").McpServerConfig>("mcp");
export const saveMcpServer = (s: import("./mcp").McpServerConfig) => saveJson("mcp", s.id, s);
export const deleteMcpServer = (id: string) => removeJson("mcp", id);

export const listToolSets = () => listJson<ToolSet>("toolsets");
export const saveToolSet = (t: ToolSet) => saveJson("toolsets", t.id, t);
export const deleteToolSet = (id: string) => removeJson("toolsets", id);

export const listProjects = () => listJson<import("./types").Project>("projects");
export const saveProject = (p: import("./types").Project) => saveJson("projects", p.id, p);
export const deleteProject = (id: string) => removeJson("projects", id);

export const listTemplates = () => listJson<Template>("templates");
export const saveTemplate = (t: Template) => saveJson("templates", t.id, t);
export const deleteTemplate = (id: string) => removeJson("templates", id);

// ---------- snapshots ----------

export interface SnapshotInfo {
  file: string; // filename inside snapshots/
  chatId: string;
  takenAt: string;
}

export async function snapshotChat(chat: Chat): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await saveJson("snapshots", `${chat.id}__${stamp}`, chat);
}

export async function listSnapshots(chatId?: string): Promise<SnapshotInfo[]> {
  const path = `${ROOT}/snapshots`;
  if (!(await exists(path, opts))) return [];
  const infos: SnapshotInfo[] = [];
  for (const e of await readDir(path, opts)) {
    if (!e.name?.endsWith(".json")) continue;
    const base = e.name.slice(0, -5);
    const [id, stamp] = base.split("__");
    if (!stamp) continue;
    if (chatId && id !== chatId) continue;
    infos.push({ file: e.name, chatId: id, takenAt: stamp.replace(/-/g, (m, i) => (i > 9 ? ":" : m)) });
  }
  return infos.sort((a, b) => b.file.localeCompare(a.file));
}

export async function readSnapshot(file: string): Promise<Chat> {
  return JSON.parse(await readTextFile(`${ROOT}/snapshots/${file}`, opts));
}

export async function deleteSnapshot(file: string): Promise<void> {
  try {
    await remove(`${ROOT}/snapshots/${file}`, opts);
  } catch {
    /* gone */
  }
}

// ---------- export ----------

function chatToMarkdown(chat: Chat): string {
  const lines = [`# ${chat.title}`, "", `Exported ${new Date().toISOString()}`, ""];
  if (chat.systemPrompt) lines.push(`## System prompt`, "", chat.systemPrompt, "");
  for (const m of chat.messages) {
    if (m.role === "tool") {
      lines.push(`**Tool result:**`, "", "```", m.content.slice(0, 2000), "```", "");
    } else {
      lines.push(`**${m.role === "user" ? "You" : "Assistant"}:**`, "", m.content, "");
    }
  }
  return lines.join("\n");
}

/**
 * Session log: one JSON object per line — a header line, then one line per step
 * with its trajectory fields (timing, round, tool name, and the context the model
 * saw). Mirrors the DeepSeek Harness `session.jsonl`, and is what the Trajectory
 * view renders, in a form other tools can diff/replay.
 */
function chatToJsonl(chat: Chat): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: "session",
      title: chat.title,
      model: chat.model,
      providerId: chat.providerId,
      createdAt: chat.createdAt,
      exportedAt: new Date().toISOString(),
      messageCount: chat.messages.length,
    }),
  );
  // recover tool names for older tool messages that predate the toolName field
  const callName: Record<string, string> = {};
  for (const m of chat.messages) for (const c of m.toolCalls ?? []) callName[c.id] = c.name;
  for (const m of chat.messages) {
    lines.push(
      JSON.stringify({
        type: m.role,
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        toolName: m.toolName ?? (m.toolCallId ? callName[m.toolCallId] : undefined),
        round: m.round,
        startedAt: m.startedAt,
        durationMs: m.durationMs,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        trace: m.trace,
        author: m.author,
      }),
    );
  }
  return lines.join("\n");
}

/** Writes the export into ~/.harnessx/exports and returns the path relative to ~/.harnessx. */
export async function exportChat(chat: Chat, format: "md" | "json" | "jsonl"): Promise<string> {
  const dir = `${ROOT}/exports`;
  if (!(await exists(dir, opts))) await mkdir(dir, { ...opts, recursive: true });
  const safe = chat.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "chat";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${safe}-${stamp}.${format}`;
  const body =
    format === "json"
      ? JSON.stringify(chat, null, 2)
      : format === "jsonl"
        ? chatToJsonl(chat)
        : chatToMarkdown(chat);
  await writeTextFile(`${dir}/${name}`, body, opts);
  return `exports/${name}`;
}
