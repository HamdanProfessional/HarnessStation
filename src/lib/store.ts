import { create } from "zustand";
import { ProviderError, streamChat } from "./providers";
import * as storage from "./storage";
import { composeSystemPrompt } from "./styles";
import { environmentNote } from "./environment";
import { basePrompt } from "./basePrompt";
import { contextWindowOf } from "./modelFacts";
import { isContextOverflow } from "./providers/overflow";
import { isWeb } from "./web";
import { os } from "./platform";
import { buildParticipantContext } from "./multiAgent";
import { BUILTIN_TOOLS, executeTool } from "./tools";
import { runAgent, syntheticTools } from "./agents";
import { runWorkflow } from "./workflow";
import { computeNextRun } from "./schedule";
import { retrieveMultiContext } from "./rag";
import { mediaConfigFromSettings, dataUrlToAttachment } from "./media";
import { skillIndexPrompt } from "./skills";
import { loadAgentsMd } from "./agentsMd";
import { capExceeded, recordUsage, syncTray } from "./budget";
import { toast } from "./toast";
import type {
  Agent,
  Chat,
  Eval,
  KnowledgeBase,
  Message,
  Preset,
  Project,
  Provider,
  Schedule,
  Settings,
  Template,
  Tool,
  ToolSet,
  Workflow,
} from "./types";

let abortController: AbortController | null = null;

/** Knowledge bases are loaded lazily; this guards against loading them twice. */
let kbLoaded = false;

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Give every message a stable id.
 *
 * The transcript used to be keyed by array index, so deleting a message made
 * React reuse each component instance for whatever message slid into its
 * position — expanded tool cards collapsed, collapsed ones opened, and an
 * in-progress edit box reattached itself to a different message. Backfilled on
 * load so conversations written before ids existed get them too.
 */
function withMessageIds(chat: Chat): Chat {
  if (chat.messages.every((m) => m.id)) return chat;
  return { ...chat, messages: chat.messages.map((m) => (m.id ? m : { ...m, id: uid() })) };
}

function newChatObj(settings: Settings): Chat {
  const p = settings.providers[0];
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    providerId: p?.id ?? "",
    model: p?.models[0] ?? "",
    systemPrompt: "",
    styleId: "normal",
    temperature: 0.7,
    maxTokens: 0,
    // Every built-in tool on by default — a new chat can act right away. Turn any
    // off per-chat in the config panel.
    enabledTools: BUILTIN_TOOLS.map((t) => t.id),
    messages: [],
  };
}

export type View =
  | "chat"
  | "voice"
  | "settings"
  | "models"
  | "discover"
  | "tools"
  | "workflows"
  | "agents"
  | "schedules"
  | "benchmarks"
  | "compare"
  | "evals"
  | "knowledge"
  | "skills"
  | "mcp"
  | "community"
  | "browser"
  | "claudecode"
  | "files";

/** What `deleteItem` removes: a whole message, its text, its reasoning, or one tool call. */
export type DeletePart = "message" | "content" | "reasoning" | { toolCallId: string };

interface AppState {
  ready: boolean;
  view: View;
  settings: Settings;
  chats: Chat[];
  /** Message count per chat from the index, so the sidebar needn't load transcripts. */
  messageCounts: Record<string, number>;
  /**
   * A voice call the Voice view should open: a chat id to resume, or "new".
   * The view clears it once it has picked it up. This is how the sidebar starts
   * or reopens a call without reaching into the session directly.
   */
  pendingVoiceChat: string | null;
  /** The call currently on air, so the sidebar can show and reopen it. */
  activeVoiceChat: string | null;
  /** What startup is doing, so the splash says something truthful. */
  bootStatus: string | null;
  /**
   * Chats whose transcript is in memory. Startup reads only the metadata index,
   * so `chat.messages` is empty until the chat is opened — and an unhydrated chat
   * must never be written back, or its file would be replaced with an empty one.
   */
  hydratedIds: Record<string, boolean>;
  presets: Preset[];
  templates: Template[];
  customTools: Tool[];
  mcpTools: Tool[];
  toolSets: ToolSet[];
  workflows: Workflow[];
  agents: Agent[];
  schedules: Schedule[];
  knowledgeBases: KnowledgeBase[];
  projects: Project[];
  /** Project the sidebar is filtered to, or null for everything. */
  activeProjectId: string | null;
  skills: import("./skills").Skill[];
  evals: Eval[];
  currentId: string | null;
  streaming: boolean;
  activity: string | null;
  error: string | null;

  allTools: () => Tool[];
  runAgentTask: (agentId: string, task: string, onEvent: (l: string) => void) => Promise<string>;
  init: () => Promise<void>;
  setView: (v: View) => void;
  /** Is the browser docked open beside the chat / call? */
  browserDock: boolean;
  setBrowserDock: (open: boolean) => void;
  /** Left nav sidebar visible (persisted across restarts). */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** Right chat config panel visible (persisted across restarts). */
  configOpen: boolean;
  setConfigOpen: (open: boolean) => void;
  saveSettings: (s: Settings) => Promise<void>;
  /** Add or update a vault secret. `value` empty = keep the existing value (edit metadata only). */
  saveSecret: (meta: { ref: string; name: string; description: string }, value: string) => Promise<void>;
  deleteSecret: (ref: string) => Promise<void>;
  ensureLocalProvider: (port: number, models: string[]) => Promise<void>;
  addCloudProvider: (p: {
    id: string;
    name: string;
    kind: "openai-compatible" | "anthropic";
    baseUrl: string;
    models: string[];
  }) => Promise<void>;

  newChat: () => void;
  /** Create a chat for a spoken session and return its id. */
  newVoiceChat: () => string;
  /** Start a fresh voice call and show the Voice view. */
  newVoiceCall: () => void;
  /** The Voice view calls this once it has acted on `pendingVoiceChat`. */
  clearPendingVoiceChat: () => void;
  /** The session reports the call it's on (null when it stops). */
  setActiveVoiceChat: (id: string | null) => void;
  selectChat: (id: string) => void;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setChatFolder: (id: string, folder: string) => Promise<void>;
  compactChat: (id: string) => Promise<void>;
  duplicateChat: (id: string) => Promise<void>;
  snapshotChat: (id: string) => Promise<void>;
  restoreSnapshot: (file: string) => Promise<void>;
  exportChat: (id: string, format: "md" | "json" | "jsonl") => Promise<string>;
  updateChat: (patch: Partial<Chat>) => void;
  /** Patch a specific chat. Streaming must use this — the user can switch chats mid-reply. */
  updateChatById: (id: string, patch: Partial<Chat>) => void;
  /** Read a chat's messages from disk if they aren't in memory yet. */
  hydrateChat: (id: string) => Promise<void>;
  /** Read every chat's messages — needed to search transcripts. */
  hydrateAllChats: () => Promise<void>;
  /** Load knowledge bases (with their embedding vectors) the first time they're needed. */
  ensureKnowledgeBases: () => Promise<void>;
  branchAt: (index: number) => void;
  editUserMessage: (index: number, text: string) => Promise<void>;
  /** Delete a message and everything after it, snapshotting first so it's reversible. */
  rewindTo: (index: number) => Promise<void>;
  /** Delete one item — a whole message, its text, its reasoning, or a single tool
   * call — to trim context. Tool-pair validity is repaired at send time. */
  deleteItem: (index: number, part: DeletePart) => Promise<void>;

  sendMessage: (text: string, attachments?: import("./types").Attachment[]) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
  clearError: () => void;

  savePresetFromChat: (name: string) => Promise<void>;
  applyPreset: (id: string) => void;
  deletePreset: (id: string) => Promise<void>;

  saveTemplate: (name: string, content: string) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  saveTool: (tool: Tool) => Promise<void>;
  deleteTool: (id: string) => Promise<void>;

  saveToolSet: (name: string, toolIds: string[]) => Promise<void>;
  deleteToolSet: (id: string) => Promise<void>;

  saveWorkflow: (wf: Workflow) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;

  saveAgent: (agent: Agent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  applyAgentToChat: (agentId: string) => void;

  saveSchedule: (s: Schedule) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  runScheduleNow: (id: string) => Promise<void>;
  tickSchedules: () => Promise<void>;

  saveProject: (p: Project) => Promise<void>;
  deleteProject: (id: string, opts?: { deleteChats?: boolean }) => Promise<void>;
  setActiveProject: (id: string | null) => void;
  /** Start a chat inside a project, inheriting its tools and knowledge. */
  newProjectChat: (projectId: string) => void;

  saveKnowledgeBase: (kb: KnowledgeBase) => Promise<void>;
  deleteKnowledgeBase: (id: string) => Promise<void>;

  saveEval: (e: Eval) => Promise<void>;
  deleteEval: (id: string) => Promise<void>;

  autoConnectMcp: () => Promise<void>;
}

/** Small persisted UI booleans (panel visibility). localStorage, best-effort. */
const readBoolPref = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const writeBoolPref = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* private mode / no storage — the toggle still works for the session */
  }
};

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  view: "chat",
  settings: storage.DEFAULT_SETTINGS,
  chats: [],
  messageCounts: {},
  hydratedIds: {},
  pendingVoiceChat: null,
  activeVoiceChat: null,
  bootStatus: null,
  presets: [],
  templates: [],
  customTools: [],
  mcpTools: [],
  toolSets: [],
  workflows: [],
  agents: [],
  schedules: [],
  knowledgeBases: [],
  projects: [],
  activeProjectId: null,
  skills: [],
  evals: [],
  currentId: null,
  streaming: false,
  activity: null,
  error: null,

  allTools: () => [
    ...BUILTIN_TOOLS,
    ...get().customTools,
    ...get().mcpTools,
    ...syntheticTools(get().agents, get().workflows),
  ],

  runAgentTask: async (agentId, task, onEvent) => {
    await get().ensureKnowledgeBases();
    const state = get();
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error("agent not found");
    // Resolve the provider/model. An agent with a providerId uses its own; an
    // agent left on "use current chat" inherits the calling chat's provider+model
    // (falling back to any provider that actually has a model).
    const chat = state.chats.find((c) => c.id === state.currentId);
    let provider = agent.providerId
      ? state.settings.providers.find((p) => p.id === agent.providerId)
      : chat && state.settings.providers.find((p) => p.id === chat.providerId);
    if (!provider) {
      provider =
        state.settings.providers.find((p) => p.models.length > 0) ?? state.settings.providers[0];
    }
    if (!provider) throw new Error("No provider configured — add one in Settings.");
    const inheritedModel = agent.providerId ? undefined : chat?.model;
    const model = agent.model || inheritedModel || provider.models[0] || "";
    if (!model) {
      throw new Error(
        `No model set for agent "${agent.name}". Give it a provider/model in the Agents editor, or open a chat that has a model selected.`,
      );
    }
    return runAgent(agent, task, {
      agents: state.agents,
      allTools: state.allTools(),
      workflows: state.workflows,
      providers: state.settings.providers,
      knowledgeBases: state.knowledgeBases,
      media: mediaConfigFromSettings(state.settings),
      provider,
      model,
      signal: new AbortController().signal,
      onEvent,
    });
  },

  init: async () => {
    // Everything here is independent — one wave of I/O rather than four in series.
    // Each one reports as it lands so the splash shows real progress instead of
    // a spinner that tells you nothing.
    let done = 0;
    const steps = 13;
    const step = <T,>(label: string, work: Promise<T>): Promise<T> =>
      work.then((v) => {
        done++;
        set({ bootStatus: `${label} · ${Math.round((done / steps) * 100)}%` });
        return v;
      });

    set({ bootStatus: "Reading your settings…" });
    const [
      settings,
      chatIndex,
      presets,
      templates,
      customTools,
      workflows,
      toolSets,
      agents,
      schedules,
      projects,
      skills,
      evals,
    ] = await Promise.all([
      step("Settings", storage.loadSettings()),
      step("Conversations", storage.loadChatIndex()),
      step("Presets", storage.loadPresets()),
      step("Templates", storage.listTemplates()),
      step("Tools", storage.listTools()),
      step("Workflows", storage.listWorkflows()),
      step("Tool sets", storage.listToolSets()),
      step("Agents", storage.listAgents()),
      step("Schedules", storage.listSchedules()),
      step("Projects", storage.listProjects()),
      step("Skills", import("./skills").then((m) => m.listSkills())),
      step("Evals", storage.listEvals()),
      step("Platform", import("./platform").then((m) => m.detectOs())),
    ]);
    // Metadata only: each chat's messages arrive when it's first opened.
    const stubs: Chat[] = chatIndex.map(({ messageCount: _n, ...meta }) => ({
      ...meta,
      messages: [],
    }));
    const first = stubs[0] ?? newChatObj(settings);
    // A brand-new chat has nothing on disk to read.
    const hydratedIds: Record<string, boolean> = stubs.length ? {} : { [first.id]: true };
    const counts: Record<string, number> = {};
    for (const m of chatIndex) counts[m.id] = m.messageCount;

    set({
      settings,
      chats: stubs.length ? stubs : [first],
      messageCounts: counts,
      hydratedIds,
      presets,
      templates,
      customTools,
      workflows,
      toolSets,
      agents,
      schedules,
      projects: [...projects].sort((a, b) => a.name.localeCompare(b.name)),
      skills,
      evals,
      currentId: first.id,
      ready: true,
      bootStatus: null,
    });
  },

  setView: (view) => set({ view }),

  browserDock: false,
  setBrowserDock: (browserDock) => set({ browserDock }),
  sidebarOpen: readBoolPref("hs-sidebar-open", true),
  setSidebarOpen: (open) => {
    writeBoolPref("hs-sidebar-open", open);
    set({ sidebarOpen: open });
  },
  configOpen: readBoolPref("hs-config-open", true),
  setConfigOpen: (open) => {
    writeBoolPref("hs-config-open", open);
    set({ configOpen: open });
  },

  saveSettings: async (settings) => {
    set({ settings });
    await storage.saveSettings(settings);
  },

  saveSecret: async ({ ref, name, description }, value) => {
    const { invalidateSecretCache } = await import("./secrets");
    // The value goes to the keychain only; settings.json keeps just metadata.
    if (value) await storage.vaultSet(ref, value);
    const now = new Date().toISOString();
    const settings = structuredClone(get().settings);
    const list = settings.secrets ?? [];
    const at = list.findIndex((s) => s.ref === ref);
    const hint = value ? value.slice(-4) : list[at]?.hint;
    const entry = {
      ref,
      name,
      description,
      hint,
      createdAt: at >= 0 ? list[at].createdAt : now,
      updatedAt: now,
    };
    if (at >= 0) list[at] = entry;
    else list.push(entry);
    settings.secrets = list;
    await get().saveSettings(settings);
    invalidateSecretCache();
  },

  deleteSecret: async (ref) => {
    const { invalidateSecretCache } = await import("./secrets");
    await storage.vaultDelete(ref);
    const settings = structuredClone(get().settings);
    settings.secrets = (settings.secrets ?? []).filter((s) => s.ref !== ref);
    await get().saveSettings(settings);
    invalidateSecretCache();
  },

  ensureLocalProvider: async (port, models) => {
    const settings = structuredClone(get().settings);
    let local = settings.providers.find((p) => p.id === "local");
    if (!local) {
      local = {
        id: "local",
        name: "Local (HarnessStation)",
        kind: "openai-compatible",
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "",
        models: [],
      };
      settings.providers.unshift(local);
    }
    local.baseUrl = `http://127.0.0.1:${port}/v1`;
    local.models = models;
    await get().saveSettings(settings);
  },

  addCloudProvider: async (p) => {
    const settings = structuredClone(get().settings);
    const existing = settings.providers.find((x) => x.id === p.id);
    if (existing) {
      existing.baseUrl = p.baseUrl;
      existing.models = p.models;
      existing.kind = p.kind;
    } else {
      settings.providers.push({
        id: p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        apiKey: "",
        models: p.models,
      });
    }
    await get().saveSettings(settings);
  },

  // ---------- chats ----------

  newChat: () => {
    const chat = newChatObj(get().settings);
    set({
      chats: [chat, ...get().chats],
      currentId: chat.id,
      view: "chat",
      hydratedIds: { ...get().hydratedIds, [chat.id]: true }, // created here, already complete
    });
  },

  newVoiceChat: () => {
    const chat: Chat = {
      ...newChatObj(get().settings),
      kind: "voice",
      title: `Voice chat — ${new Date().toLocaleString()}`,
    };
    set({
      chats: [chat, ...get().chats],
      hydratedIds: { ...get().hydratedIds, [chat.id]: true },
    });
    return chat.id;
  },

  newVoiceCall: () => set({ view: "voice", pendingVoiceChat: "new" }),

  clearPendingVoiceChat: () => set({ pendingVoiceChat: null }),

  setActiveVoiceChat: (id) => set({ activeVoiceChat: id }),

  selectChat: (id) => {
    // A spoken conversation reopens as a call, not as a transcript to type into.
    if (get().chats.find((c) => c.id === id)?.kind === "voice") {
      set({ currentId: id, view: "voice", pendingVoiceChat: id });
      return;
    }
    set({ currentId: id, view: "chat" });
    void get().hydrateChat(id);
  },

  deleteChat: async (id) => {
    await storage.deleteChat(id);
    const { [id]: _unloaded, ...hydratedIds } = get().hydratedIds;
    set({ hydratedIds });
    const chats = get().chats.filter((c) => c.id !== id);
    const { [id]: _gone, ...messageCounts } = get().messageCounts;
    set({ messageCounts });
    if (!chats.length) {
      const fresh = newChatObj(get().settings);
      set({
        chats: [fresh],
        currentId: fresh.id,
        hydratedIds: { ...get().hydratedIds, [fresh.id]: true },
      });
    } else {
      set({ chats, currentId: get().currentId === id ? chats[0].id : get().currentId });
    }
  },

  renameChat: async (id, title) => {
    await get().hydrateChat(id);
    const chats = get().chats.map((c) => (c.id === id ? { ...c, title } : c));
    set({ chats });
    const chat = chats.find((c) => c.id === id);
    if (chat && chat.messages.length) await storage.saveChat(chat);
  },

  togglePin: async (id) => {
    await get().hydrateChat(id);
    const chats = get().chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c));
    set({ chats });
    const chat = chats.find((c) => c.id === id);
    if (chat && chat.messages.length) await storage.saveChat(chat);
  },

  setChatFolder: async (id, folder) => {
    await get().hydrateChat(id);
    const chats = get().chats.map((c) => (c.id === id ? { ...c, folder: folder || undefined } : c));
    set({ chats });
    const chat = chats.find((c) => c.id === id);
    if (chat && chat.messages.length) await storage.saveChat(chat);
  },

  compactChat: async (id) => {
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return;
    const provider = get().settings.providers.find((p) => p.id === chat.providerId);
    if (!provider || !chat.model) {
      toast.error("Set this chat's provider and model before compacting.");
      return;
    }
    const keepLast = 6;
    const upto = chat.messages.length - keepLast;
    if (upto <= (chat.summaryUpto ?? 0)) {
      toast.info(`Nothing new to compact — the last ${keepLast} messages are always kept in full.`);
      return; // nothing new to fold in
    }
    const older = chat.messages.slice(0, upto).filter((m) => m.role !== "tool");
    const transcript = older.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 14000);
    const prev = chat.summary ? `Existing summary:\n${chat.summary}\n\n` : "";
    set({ activity: "Compacting older messages…" });
    try {
      const { chatOnce } = await import("./providers");
      const summary = await chatOnce(
        provider,
        chat.model,
        "You compress conversations. Produce concise bullet notes capturing key facts, decisions, code, and context so the assistant can continue without the full history. Keep it under 300 words.",
        `${prev}Conversation to summarize:\n${transcript}`,
        new AbortController().signal,
      );
      const chats = get().chats.map((c) =>
        c.id === id ? { ...c, summary: summary.trim(), summaryUpto: upto } : c,
      );
      set({ chats });
      const updated = chats.find((c) => c.id === id);
      if (updated) await storage.saveChat(updated);
      toast.success(`Compacted ${older.length} earlier message(s) into the summary.`);
    } catch (e) {
      toast.error(`Compact failed: ${(e as Error).message || String(e)}`);
    } finally {
      set({ activity: null });
    }
  },

  duplicateChat: async (id) => {
    await get().hydrateChat(id);
    const src = get().chats.find((c) => c.id === id);
    if (!src) return;
    const copy: Chat = structuredClone(src);
    copy.id = uid();
    copy.title = `${src.title} (copy)`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    set({
      chats: [copy, ...get().chats],
      currentId: copy.id,
      hydratedIds: { ...get().hydratedIds, [copy.id]: true },
    });
    if (copy.messages.length) await storage.saveChat(copy);
    toast.success("Chat duplicated");
  },

  snapshotChat: async (id) => {
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (chat) {
      await storage.snapshotChat(chat);
      toast.success("Snapshot saved");
    }
  },

  restoreSnapshot: async (file) => {
    const snap = await storage.readSnapshot(file);
    const restored: Chat = { ...snap, id: uid(), title: `${snap.title} (restored)` };
    restored.updatedAt = new Date().toISOString();
    set({
      chats: [restored, ...get().chats],
      currentId: restored.id,
      view: "chat",
      hydratedIds: { ...get().hydratedIds, [restored.id]: true },
    });
    if (restored.messages.length) await storage.saveChat(restored);
    toast.success("Snapshot restored");
  },

  exportChat: async (id, format) => {
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) throw new Error("chat not found");
    return storage.exportChat(chat, format);
  },

  updateChat: (patch) => {
    const { currentId } = get();
    if (currentId) get().updateChatById(currentId, patch);
  },

  updateChatById: (id, patch) => {
    const updated = get().chats.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
    );
    set({ chats: updated });
    const chat = updated.find((c) => c.id === id);
    // Never write a chat whose transcript isn't loaded — that would replace the
    // file with an empty one. Callers hydrate before mutating; this is the net.
    if (chat && chat.messages.length > 0 && get().hydratedIds[id]) storage.queueSaveChat(chat);
  },

  hydrateChat: async (id) => {
    if (get().hydratedIds[id]) return;
    // Anything already holding messages in memory is authoritative, and must not
    // be overwritten by whatever last reached disk.
    //
    // Chats built from the index always start empty — messages only ever arrive
    // here or from a live turn. So a non-empty chat means a turn is in flight or
    // already hydrated, and saves are coalesced at 400 ms behind it. Reading the
    // body mid-turn handed back a copy from *before* the newest tool result and
    // replaced the live array with it: the result appeared, then vanished a
    // moment later. Any hydrate racing a turn could do it — enabling a tool,
    // opening the sidebar search, moving a chat out of a project.
    const existing = get().chats.find((c) => c.id === id);
    if (existing && existing.messages.length > 0) {
      set({ hydratedIds: { ...get().hydratedIds, [id]: true } });
      return;
    }
    const body = await storage.loadChatBody(id);
    set({
      // Marked even when the read failed: a missing file has nothing more to give,
      // and retrying on every keystroke would be worse than showing it empty.
      hydratedIds: { ...get().hydratedIds, [id]: true },
      chats: body
        ? get().chats.map((c) =>
            c.id === id ? withMessageIds({ ...body, ...c, messages: body.messages }) : c,
          )
        : get().chats,
    });
  },

  hydrateAllChats: async () => {
    const pending = get().chats.filter((c) => !get().hydratedIds[c.id]);
    if (!pending.length) return;
    const bodies = await Promise.all(pending.map((c) => storage.loadChatBody(c.id)));
    const byId = new Map<string, Chat>();
    const marks = { ...get().hydratedIds };
    pending.forEach((c, i) => {
      marks[c.id] = true;
      const body = bodies[i];
      if (body) byId.set(c.id, body);
    });
    set({
      hydratedIds: marks,
      chats: get().chats.map((c) => {
        const body = byId.get(c.id);
        return body ? withMessageIds({ ...body, ...c, messages: body.messages }) : c;
      }),
    });
  },

  ensureKnowledgeBases: async () => {
    // Embedding vectors are by far the largest thing on disk; loading them at
    // startup costs every launch for a feature most sessions never touch.
    if (get().knowledgeBases.length || kbLoaded) return;
    kbLoaded = true;
    try {
      set({ knowledgeBases: await storage.listKnowledgeBases() });
    } catch {
      kbLoaded = false; // let the next caller retry
    }
  },

  branchAt: (index) => {
    const src = get().chats.find((c) => c.id === get().currentId);
    if (!src) return;
    const now = new Date().toISOString();
    const branch: Chat = {
      ...structuredClone(src),
      id: uid(),
      title: `${src.title} (branch)`,
      createdAt: now,
      updatedAt: now,
      messages: src.messages.slice(0, index + 1),
    };
    set({
      chats: [branch, ...get().chats],
      currentId: branch.id,
      hydratedIds: { ...get().hydratedIds, [branch.id]: true },
    });
    void storage.saveChat(branch);
    toast.success("Branch created");
  },

  editUserMessage: async (index, text) => {
    const chat = get().chats.find((c) => c.id === get().currentId);
    if (!chat || get().streaming) return;
    const msgs = chat.messages.slice(0, index);
    msgs.push({ role: "user", content: text });
    get().updateChat({ messages: msgs });
    await runCompletion(set, get);
  },

  deleteItem: async (index, part) => {
    const id = get().currentId;
    if (!id || get().streaming) return;
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return;
    const m = chat.messages[index];
    if (!m) return;

    const { estimateContextTokens } = await import("./tokens");
    const before = estimateContextTokens(chat.messages);

    const msgs = [...chat.messages];
    let next: Message | null = { ...m };
    if (part === "message") {
      next = null;
    } else if (part === "content") {
      next.content = "";
    } else if (part === "reasoning") {
      next.reasoning = undefined;
    } else {
      // a single tool call, by id
      const kept = (m.toolCalls ?? []).filter((c) => c.id !== part.toolCallId);
      next.toolCalls = kept.length ? kept : undefined;
    }

    // A message left with no content, no tool calls, no reasoning and no
    // attachments carries nothing — remove it rather than send an empty turn.
    const empty =
      next &&
      !next.content.trim() &&
      !next.toolCalls?.length &&
      !next.reasoning &&
      !next.attachments?.length;
    if (next === null || empty) msgs.splice(index, 1);
    else msgs[index] = next;

    get().updateChat({ messages: msgs });

    // Force-persist — the coalescing queue skips an empty transcript, and
    // deleting the last item legitimately empties the chat.
    const nowChat = get().chats.find((c) => c.id === id);
    if (nowChat) {
      storage.cancelChatSave(id);
      await storage.saveChat(nowChat);
    }

    if (part === "reasoning") {
      // Thinking is shown for you only — the model never receives it on later
      // turns, so removing it tidies the transcript but frees no prompt tokens.
      toast.success("Removed thinking — it's display-only, so token cost is unchanged.");
    } else {
      const freed = Math.max(0, before - estimateContextTokens(msgs));
      toast.success(`Deleted — freed ~${freed} token${freed === 1 ? "" : "s"} of context`);
    }
  },

  rewindTo: async (index) => {
    const id = get().currentId;
    if (!id || get().streaming) return;
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return;
    const removed = chat.messages.length - index;
    if (removed <= 0) return;

    // Snapshot before deleting, so a rewind is reversible — this is what makes it
    // safe to go back destructively rather than only via a branch. Best-effort:
    // losing the snapshot shouldn't block the rewind the user asked for.
    try {
      await storage.snapshotChat(chat);
    } catch {
      /* snapshot is a safety net, not a precondition */
    }

    // Keep everything before this message; drop it and all that follow.
    const kept = chat.messages.slice(0, index);
    get().updateChat({ messages: kept });

    // Persist directly rather than through the coalescing queue: that queue
    // deliberately refuses to write an empty transcript (its guard against
    // clobbering a chat before it's hydrated), and rewinding to the very start
    // legitimately empties it. Force the truncated state — including empty — to
    // disk so a reload doesn't resurrect the deleted messages.
    const now = get().chats.find((c) => c.id === id);
    if (now) {
      storage.cancelChatSave?.(id);
      await storage.saveChat(now);
    }
    toast.success(
      `Removed ${removed} message${removed === 1 ? "" : "s"} — restore from the chat's Snapshots if needed`,
    );
  },

  // ---------- messaging ----------

  sendMessage: async (text, attachments) => {
    const id = get().currentId;
    if (!id || get().streaming) return;
    // Guard the race between opening a chat and typing into it: sending before
    // the transcript arrives would append to an empty list and drop the history.
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (!chat || get().streaming) return;
    const userMsg: Message = { role: "user", content: text };
    // @-references (@file:… / @https://…) pull content into the message. The
    // cheap `@` guard keeps the common path (and its concurrency behaviour)
    // untouched — nothing async happens unless a reference is actually present.
    let refAttachments: import("./types").Attachment[] = [];
    if (text.includes("@")) {
      const { hasReferences, resolveReferences } = await import("./references");
      if (hasReferences(text)) {
        set({ activity: "Loading references…" });
        refAttachments = await resolveReferences(text, chat.workingDir ?? "");
      }
    }
    const merged = [...(attachments ?? []), ...refAttachments];
    if (merged.length) userMsg.attachments = merged;
    const patch: Partial<Chat> = {
      messages: [...chat.messages, userMsg],
    };
    if (chat.messages.length === 0) {
      patch.title = text.length > 42 ? `${text.slice(0, 42)}...` : text;
    }
    get().updateChat(patch);
    const cur = get().chats.find((c) => c.id === id);
    if (cur && (cur.mode === "battle" || cur.mode === "collab") && (cur.participants?.length ?? 0) >= 2) {
      await runMultiCompletion(set, get);
    } else {
      await runCompletion(set, get);
    }
  },

  regenerate: async () => {
    const id = get().currentId;
    if (!id || get().streaming) return;
    await get().hydrateChat(id);
    const chat = get().chats.find((c) => c.id === id);
    if (!chat || get().streaming) return;
    const msgs = [...chat.messages];
    while (msgs.length && msgs[msgs.length - 1].role !== "user") msgs.pop();
    if (!msgs.length) return;
    get().updateChat({ messages: msgs });
    await runCompletion(set, get);
  },

  stop: () => {
    // A question can only be answered by the turn that asked it, so stopping
    // the turn must end it too — otherwise it sits there blocking a tool call
    // that nothing will ever read.
    void import("./askUser").then((m) => m.cancel("The turn was stopped."));
    abortController?.abort();
  },

  clearError: () => set({ error: null }),

  // ---------- presets ----------

  savePresetFromChat: async (name) => {
    const chat = get().chats.find((c) => c.id === get().currentId);
    if (!chat) return;
    const preset: Preset = {
      id: uid(),
      name,
      systemPrompt: chat.systemPrompt,
      styleId: chat.styleId,
      temperature: chat.temperature,
      maxTokens: chat.maxTokens,
    };
    await storage.savePreset(preset);
    set({ presets: [...get().presets, preset].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  applyPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return;
    get().updateChat({
      systemPrompt: preset.systemPrompt,
      styleId: preset.styleId,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
    });
  },

  deletePreset: async (id) => {
    await storage.deletePreset(id);
    set({ presets: get().presets.filter((p) => p.id !== id) });
  },

  // ---------- instruction templates ----------

  saveTemplate: async (name, content) => {
    const t: Template = { id: uid(), name, content };
    await storage.saveTemplate(t);
    set({ templates: [...get().templates, t].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteTemplate: async (id) => {
    await storage.deleteTemplate(id);
    set({ templates: get().templates.filter((t) => t.id !== id) });
  },

  // ---------- tools ----------

  saveTool: async (tool) => {
    await storage.saveTool(tool);
    const rest = get().customTools.filter((t) => t.id !== tool.id);
    set({ customTools: [...rest, tool].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteTool: async (id) => {
    await storage.deleteTool(id);
    set({ customTools: get().customTools.filter((t) => t.id !== id) });
  },

  saveToolSet: async (name, toolIds) => {
    const set: ToolSet = { id: uid(), name, toolIds };
    await storage.saveToolSet(set);
    useStore.setState({
      toolSets: [...get().toolSets, set].sort((a, b) => a.name.localeCompare(b.name)),
    });
  },

  deleteToolSet: async (id) => {
    await storage.deleteToolSet(id);
    useStore.setState({ toolSets: get().toolSets.filter((t) => t.id !== id) });
  },

  // ---------- workflows ----------

  saveWorkflow: async (wf) => {
    await storage.saveWorkflow(wf);
    const rest = get().workflows.filter((w) => w.id !== wf.id);
    set({ workflows: [...rest, wf].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteWorkflow: async (id) => {
    await storage.deleteWorkflow(id);
    set({ workflows: get().workflows.filter((w) => w.id !== id) });
  },

  // ---------- agents ----------

  saveAgent: async (agent) => {
    await storage.saveAgent(agent);
    const rest = get().agents.filter((a) => a.id !== agent.id);
    set({ agents: [...rest, agent].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteAgent: async (id) => {
    await storage.deleteAgent(id);
    set({ agents: get().agents.filter((a) => a.id !== id) });
  },

  applyAgentToChat: (agentId) => {
    const agent = get().agents.find((a) => a.id === agentId);
    if (!agent) return;
    const patch: Partial<Chat> = {
      systemPrompt: agent.instructions,
      enabledTools: [
        ...agent.toolIds,
        ...agent.subAgentIds.map((id) => `agent:${id}`),
        ...agent.workflowIds.map((id) => `workflow:${id}`),
      ],
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
    };
    if (agent.providerId) patch.providerId = agent.providerId;
    if (agent.model) patch.model = agent.model;
    patch.agentId = agentId;
    get().updateChat(patch);
    set({ view: "chat" });
    toast.success(`Agent applied: ${agent.name}`);
  },

  // ---------- schedules ----------

  saveSchedule: async (s) => {
    await storage.saveSchedule(s);
    const rest = get().schedules.filter((x) => x.id !== s.id);
    set({ schedules: [...rest, s].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteSchedule: async (id) => {
    await storage.deleteSchedule(id);
    set({ schedules: get().schedules.filter((s) => s.id !== id) });
  },

  runScheduleNow: async (id) => {
    const s = get().schedules.find((x) => x.id === id);
    if (s) await executeSchedule(s, get, set);
  },

  saveProject: async (p) => {
    const next = { ...p, updatedAt: new Date().toISOString() };
    const rest = get().projects.filter((x) => x.id !== p.id);
    set({ projects: [...rest, next].sort((a, b) => a.name.localeCompare(b.name)) });
    await storage.saveProject(next);
  },

  deleteProject: async (id, opts) => {
    // Chats outlive the project by default — losing a month of conversations
    // because a folder was tidied away is not a recoverable mistake.
    const chats = get().chats.filter((c) => c.projectId === id);
    if (opts?.deleteChats) {
      for (const c of chats) await get().deleteChat(c.id);
    } else {
      for (const c of chats) {
        await get().hydrateChat(c.id);
        get().updateChatById(c.id, { projectId: undefined });
      }
    }
    await storage.deleteProject(id);
    // The project's own memory goes with it; global and per-chat memory stay.
    try {
      const { forgetAll } = await import("./memory");
      const { projectScope } = await import("./memoryScopes");
      await forgetAll(projectScope(id));
    } catch {
      /* memory file may not exist */
    }
    set({
      projects: get().projects.filter((p) => p.id !== id),
      activeProjectId: get().activeProjectId === id ? null : get().activeProjectId,
    });
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  newProjectChat: (projectId) => {
    const project = get().projects.find((p) => p.id === projectId);
    const chat: Chat = {
      ...newChatObj(get().settings),
      projectId,
      enabledTools: project?.defaultToolIds ?? [],
      knowledgeBaseIds: project?.knowledgeBaseIds ?? [],
    };
    set({
      chats: [chat, ...get().chats],
      currentId: chat.id,
      view: "chat",
      activeProjectId: projectId,
      hydratedIds: { ...get().hydratedIds, [chat.id]: true },
    });
  },

  saveKnowledgeBase: async (kb) => {
    await storage.saveKnowledgeBase(kb);
    const rest = get().knowledgeBases.filter((k) => k.id !== kb.id);
    set({ knowledgeBases: [...rest, kb].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteKnowledgeBase: async (id) => {
    await storage.deleteKnowledgeBase(id);
    set({ knowledgeBases: get().knowledgeBases.filter((k) => k.id !== id) });
  },

  saveEval: async (e) => {
    await storage.saveEval(e);
    const rest = get().evals.filter((x) => x.id !== e.id);
    set({ evals: [...rest, e].sort((a, b) => a.name.localeCompare(b.name)) });
  },

  deleteEval: async (id) => {
    await storage.deleteEval(id);
    set({ evals: get().evals.filter((e) => e.id !== id) });
  },

  autoConnectMcp: async () => {
    const servers = (await storage.listMcpServers()).filter((s) => s.autoConnect);
    if (!servers.length) return;
    const { mcpConnect, mcpToolToChatTool } = await import("./mcp");
    const collected: Tool[] = [];
    await Promise.all(
      servers.map(async (cfg) => {
        try {
          const infos = await mcpConnect(cfg);
          collected.push(...infos.map((t) => mcpToolToChatTool(cfg.id, cfg.name, t)));
          toast.success(`${cfg.name} connected — ${infos.length} tools`);
        } catch (e) {
          toast.error(`${cfg.name}: ${(e as Error).message || String(e)}`);
        }
      }),
    );
    if (collected.length) set({ mcpTools: [...get().mcpTools, ...collected] });
  },

  tickSchedules: async () => {
    const now = Date.now();
    const due = get().schedules.filter((s) => s.enabled && s.nextRun <= now);
    for (const s of due) {
      // re-read latest copy each iteration
      const cur = get().schedules.find((x) => x.id === s.id);
      if (cur && cur.enabled && cur.nextRun <= Date.now()) {
        await executeSchedule(cur, get, set);
      }
    }
  },
}));

async function executeSchedule(s: Schedule, get: Get, set: Set): Promise<void> {
  const now = Date.now();
  let result = "";
  let error: string | undefined;
  try {
    if (s.targetType === "agent") {
      result = await get().runAgentTask(s.targetId, s.input, () => {});
    } else {
      const wf = get().workflows.find((w) => w.id === s.targetId);
      if (!wf) throw new Error("workflow not found");
      const provider =
        get().settings.providers.find((p) => p.id === s.providerId) ?? get().settings.providers[0];
      if (!provider) throw new Error("no provider configured");
      result = await runWorkflow(wf, {
        provider,
        model: s.model || provider.models[0] || "",
        tools: get().allTools(),
        input: s.input,
        signal: new AbortController().signal,
        onLog: () => {},
        runAgent: (agentId, agentInput) => get().runAgentTask(agentId, agentInput, () => {}),
        media: mediaConfigFromSettings(get().settings),
      });
    }
  } catch (e) {
    error = (e as Error).message || String(e);
  }

  const next = s.cadence.type === "once" ? 0 : computeNextRun(s.cadence, Date.now()) ?? 0;
  const updated: Schedule = {
    ...s,
    lastRun: now,
    lastResult: error ? undefined : result,
    lastError: error,
    nextRun: next || s.nextRun,
    enabled: s.cadence.type === "once" ? false : s.enabled,
  };
  await storage.saveSchedule(updated);
  set({ schedules: get().schedules.map((x) => (x.id === s.id ? updated : x)) });
  if (error) toast.error(`Schedule "${s.name}" failed`);
  else toast.success(`Schedule "${s.name}" ran`);

  // Fire the schedule-complete hook, and deliver the output to the schedule's
  // own webhook/Slack destination if it has one.
  void import("./hooks").then((h) => {
    h.fireHook("schedule-complete", {
      scheduleName: s.name,
      error,
      summary: error ? `Schedule “${s.name}” failed: ${error}` : `*${s.name}*\n${result.slice(0, 3500)}`,
    });
    if (!error) void h.deliverScheduleResult(s, result);
  });

  if (s.saveToChat && !error) {
    const p = get().settings.providers.find((x) => x.id === s.providerId) ?? get().settings.providers[0];
    const nowIso = new Date().toISOString();
    const chat: Chat = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${s.name} — ${new Date().toLocaleString()}`,
      createdAt: nowIso,
      updatedAt: nowIso,
      providerId: p?.id ?? "",
      model: s.model || p?.models[0] || "",
      systemPrompt: "",
      styleId: "normal",
      temperature: 0.7,
      maxTokens: 0,
      enabledTools: [],
      messages: [
        { role: "user", content: s.input },
        { role: "assistant", content: result },
      ],
    };
    await storage.saveChat(chat);
    set({
      chats: [chat, ...get().chats],
      hydratedIds: { ...get().hydratedIds, [chat.id]: true },
    });
  }
}

type Set = (partial: Partial<AppState>) => void;
type Get = () => AppState;

async function runCompletion(set: Set, get: Get): Promise<void> {
  const { settings } = get();
  const chat = get().chats.find((c) => c.id === get().currentId);
  if (!chat) return;
  const provider = settings.providers.find((p) => p.id === chat.providerId);
  if (!provider) {
    set({ error: "No provider selected — pick one in the panel on the right." });
    return;
  }
  if (!chat.model) {
    set({ error: "No model selected — pick or type one in the panel on the right." });
    return;
  }

  // Re-read each round: enable_tool can switch a new tool on mid-task, and it
  // should be callable on the very next step rather than the next message.
  const resolveTools = () => {
    const cur = get().chats.find((c) => c.id === chat.id) ?? chat;
    return provider.kind === "openai-compatible" && cur.enabledTools?.length
      ? get().allTools().filter((t) => cur.enabledTools!.includes(t.id))
      : [];
  };
  let enabledTools = resolveTools();

  // Spend cap: refuse before spending anything, not halfway through a tool chain.
  const capped = capExceeded(settings.dailyCapUsd, settings.monthlyCapUsd);
  if (capped) {
    set({ error: capped });
    return;
  }

  abortController = new AbortController();
  set({ streaming: true, error: null });

  // The chat itself is a swarm participant, so agents it spawns can message it
  // and it gets told when they edit a file it has read.
  const { joinSwarm, leaveSwarm, takeInbox } = await import("./swarm");
  const chatSession = joinSwarm(chat.title || "Chat", chat.workingDir ?? "");

  // Everything below writes to *this* chat by id, never to whatever is on screen:
  // the user can switch chats (or delete this one) while the reply is streaming.
  const live = () => get().chats.find((c) => c.id === chat.id);
  const patch = (p: Partial<Chat>) => get().updateChatById(chat.id, p);

  const appendMsg = (m: Message) => {
    const cur = live();
    // Every message gets an id here so the transcript can be keyed by identity
    // rather than by position.
    if (cur) patch({ messages: [...cur.messages, m.id ? m : { ...m, id: uid() }] });
  };

  /** Rewrite the last message of this chat. No-op if the chat vanished. */
  const patchLast = (fn: (m: Message) => Message) => {
    const cur = live();
    if (!cur || !cur.messages.length) return;
    const msgs = [...cur.messages];
    msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
    patch({ messages: msgs });
  };

  // RAG: retrieve context from the chat's knowledge base(s) for the latest user turn
  let ragContext = "";
  const kbIds = chat.knowledgeBaseIds ?? (chat.knowledgeBaseId ? [chat.knowledgeBaseId] : []);
  if (kbIds.length) {
    await get().ensureKnowledgeBases();
    const kbs = get().knowledgeBases.filter((k) => kbIds.includes(k.id));
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    if (kbs.length && lastUser) {
      try {
        ragContext = await retrieveMultiContext(kbs, lastUser.content, (kb) =>
          settings.providers.find((p) => p.id === kb.embedProviderId),
        );
      } catch (e) {
        set({ error: `Knowledge retrieval failed: ${(e as Error).message || String(e)}` });
      }
    }
  }

  // auto-compaction: fold old turns into a summary when the chat grows too large
  if (settings.autoCompact) {
    const est = chat.messages.reduce((n, m) => n + m.content.length, 0) / 4;
    // Prefer the model's real context window over the fixed threshold. 8000 is
    // wrong for every model we ship — it compacts a 200k-context model twenty
    // times too early, and never saves a 4k one. Compact at 70%, leaving room
    // for the reply and for the estimate being an estimate.
    const window = contextWindowOf(chat.model);
    const limit = window ? window * 0.7 : (settings.compactThreshold ?? 8000);
    if (est > limit) {
      await get().compactChat(chat.id);
    }
  }
  const cchat = live() ?? chat;
  const summaryNote = cchat.summary
    ? `\n\nSummary of earlier conversation:\n${cchat.summary}`
    : "";
  let startIdx = cchat.summary ? (cchat.summaryUpto ?? 0) : 0;
  // advance to the next user turn so we never send a dangling assistant/tool message
  while (startIdx > 0 && startIdx < cchat.messages.length && cchat.messages[startIdx].role !== "user") {
    startIdx++;
  }

  // A project's description and instructions apply to every chat inside it, so
  // you don't restate the brief in each conversation.
  const project = chat.projectId ? get().projects.find((p) => p.id === chat.projectId) : undefined;
  const projectNote = project
    ? [
        `You are working inside the project "${project.name}".`,
        project.description.trim(),
        project.instructions.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // AGENTS.md in the working directory steers the model with repo conventions,
  // read automatically so the user doesn't restate them each chat (desktop only).
  const agentsNote =
    settings.agentsFile !== false ? await loadAgentsMd(chat.workingDir) : "";

  const agentName = chat.agentId
    ? get().agents.find((a) => a.id === chat.agentId)?.name
    : undefined;

  // Skills: only names + descriptions go in the prompt; the model loads the full
  // playbook with use_skill when one is relevant (progressive disclosure).
  const skillIndex = enabledTools.some((t) => t.id === "use_skill")
    ? skillIndexPrompt(get().skills)
    : "";

  // Passive memory: pull what we already know that's relevant to this turn and put
  // it in the prompt. The model never has to decide to look — it just knows.
  let memoryBlock = "";
  if (settings.passiveMemory) {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      try {
        const { recallBlock, GLOBAL_MEMORY } = await import("./memory");
        memoryBlock = await recallBlock(GLOBAL_MEMORY, lastUser.content, settings.memoryK ?? 6);
      } catch {
        /* memory is optional — a failure must never block the reply */
      }
    }
  }

  try {
    // tool loop: keep going while the model requests tool calls. With auto-continue on,
    // it runs a long chain unattended (up to a hard ceiling); otherwise it stops sooner
    // and asks the user to continue. A repeated-call guard breaks stuck loops.
    const autoContinue = settings.autoContinue ?? true;
    const MAX_TOOL_ROUNDS = autoContinue ? 60 : 25;
    let reachedLimit = true;
    let lastSig = "";
    let repeats = 0;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Re-check each round: a long unattended chain must not sail past the cap.
      const overBudget = round > 0 && capExceeded(settings.dailyCapUsd, settings.monthlyCapUsd);
      if (overBudget) {
        appendMsg({ role: "assistant", content: `_Stopped: ${overBudget}_` });
        reachedLimit = false;
        break;
      }
      enabledTools = resolveTools();
      appendMsg({ role: "assistant", content: "" });
      set({ activity: agentName ? `${agentName} is thinking...` : "Generating..." });
      const base = live();
      if (!base) break; // chat was deleted mid-turn — nothing left to write to
      const history = base.messages.slice(startIdx, -1);

      // Facts about now that the model cannot know and will otherwise invent:
      // the date (it answers from its cutoff), the platform (run_terminal is
      // PowerShell on Windows), and which model is actually answering.
      // Rebuilt each round so a mid-chat model switch is reflected.
      const envNote = environmentNote({
        os: os(),
        workingDir: base.workingDir,
        model: base.model,
        providerName: settings.providers.find((x) => x.id === base.providerId)?.name,
        now: new Date(),
        web: isWeb(),
      });

      // The house rules, first, so anything the user configured can override
      // them by coming later. Conditional on what this turn actually has:
      // describing tools to a chat with none invites the model to invent one.
      const houseRules =
        settings.baseSystemPrompt === false
          ? ""
          : basePrompt({
              toolCount: enabledTools.length,
              hasShell: enabledTools.some((t) => t.id === "run_terminal"),
              hasFiles: enabledTools.some((t) => t.id === "read_file" || t.id === "edit_file"),
            });

      // Compose once so the exact prompt the model receives can also be traced.
      const systemStr = [
        houseRules,
        composeSystemPrompt(settings, base),
        envNote,
        projectNote,
        agentsNote,
        skillIndex,
        memoryBlock,
        ragContext,
        summaryNote,
      ]
        .filter(Boolean)
        .join("\n\n");
      const turnStart = Date.now();

      // Captured once per round: moving the call into a closure loses the
      // narrowing the surrounding code already did on abortController.
      const ac = abortController;
      const send = () =>
        streamChat({
          provider,
          model: chat.model,
          system: systemStr,
          messages: history,
          temperature: chat.temperature,
          maxTokens: chat.maxTokens,
          tools: enabledTools,
          jsonSchema: chat.jsonSchema,
          signal: ac.signal,
          onDelta: (delta) => patchLast((m) => ({ ...m, content: m.content + delta })),
          onReasoning: (delta) => patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? "") + delta })),
        });

      let result;
      try {
        result = await send();
      } catch (e) {
        // "Your prompt is too long" is the one failure with an obvious fix, and
        // failing over to another key cannot help — the next key receives the
        // same oversized prompt. Compact once and resend. Only once: if the
        // compacted prompt still overflows, something else is wrong and looping
        // would burn a summarisation call per attempt.
        const msg = (e as Error)?.message ?? "";
        const status = (e as ProviderError)?.status;
        const alreadySummarised = !!(live() ?? chat).summary;
        if (!isContextOverflow(msg, status) || alreadySummarised || ac.signal.aborted) {
          throw e;
        }
        set({ activity: "Conversation too long — summarising and retrying..." });
        await get().compactChat(chat.id);
        const after = live();
        if (!after) throw e;
        // compactChat rewrites where the sent history starts, so rebuild it.
        let from = after.summaryUpto ?? 0;
        while (from > 0 && from < after.messages.length && after.messages[from].role !== "user") from++;
        history.length = 0;
        history.push(...after.messages.slice(from, -1));
        result = await send();
      }

      if (result.usage) {
        recordUsage(
          provider.id,
          chat.model,
          result.usage.promptTokens,
          result.usage.completionTokens,
        );
        void syncTray();
        const { promptTokens, completionTokens } = result.usage;
        patchLast((m) => ({ ...m, promptTokens, completionTokens }));
      }

      // Trajectory: stamp timing + round on every assistant step, and the loaded
      // context on the first round only (it's stable across the turn, so storing
      // it each round would bloat the saved conversation).
      const durationMs = Date.now() - turnStart;
      patchLast((m) => ({
        ...m,
        round,
        startedAt: turnStart,
        durationMs,
        ...(round === 0
          ? {
              trace: {
                system: systemStr || undefined,
                rag: ragContext || undefined,
                memory: memoryBlock || undefined,
                skills: skillIndex || undefined,
                project: projectNote || undefined,
                agentsMd: agentsNote || undefined,
              },
            }
          : {}),
      }));

      if (!result.toolCalls?.length) {
        reachedLimit = false;
        break;
      }

      // loop-guard: if the model repeats the exact same tool call(s) with no progress,
      // stop rather than burning the whole budget on a stuck retry.
      const sig = result.toolCalls.map((c) => `${c.name}:${c.arguments}`).join("|");
      repeats = sig === lastSig ? repeats + 1 : 0;
      lastSig = sig;
      if (repeats >= 2) {
        const msgs = live()?.messages ?? [];
        const last = msgs[msgs.length - 1];
        if (last && last.role === "assistant" && !last.content && !last.toolCalls) {
          patch({ messages: msgs.slice(0, -1) });
        }
        appendMsg({
          role: "assistant",
          content: "_Stopped: the model repeated the same tool call several times without progress._",
        });
        reachedLimit = false;
        break;
      }

      // record the tool calls on the assistant message, then run each tool
      patchLast((m) => ({ ...m, toolCalls: result.toolCalls ?? undefined }));
      for (const call of result.toolCalls) {
        const tool = enabledTools.find((t) => t.name === call.name);
        let output: string;
        const toolStart = Date.now();
        try {
          const args = JSON.parse(call.arguments || "{}");
          set({ activity: `Running ${call.name.replace(/[_-]+/g, " ")}...` });
          if (!tool) {
            output = `Error: unknown tool ${call.name}`;
          } else if (tool.id.startsWith("agent:")) {
            const subName = get().agents.find((a) => a.id === tool.id.slice(6))?.name ?? "agent";
            output = await get().runAgentTask(tool.id.slice(6), String(args.query ?? ""), (l) =>
              set({ activity: `${subName}: ${l.trim().slice(0, 60)}` }),
            );
          } else if (tool.id.startsWith("workflow:")) {
            const wf = get().workflows.find((w) => w.id === tool.id.slice(9));
            output = wf
              ? await runWorkflow(wf, {
                  provider,
                  model: chat.model,
                  tools: get().allTools(),
                  input: String(args.input ?? ""),
                  signal: abortController!.signal,
                  onLog: () => {},
                  runAgent: (agentId, agentInput) => get().runAgentTask(agentId, agentInput, () => {}),
                  media: mediaConfigFromSettings(get().settings),
                })
              : "Error: workflow not found";
          } else if (tool.id === "swarm_spawn") {
            // Fan subtasks out to helper agents running at the same time.
            const tasks = (Array.isArray(args.tasks) ? args.tasks : []).map(String).filter(Boolean);
            const named = String(args.agent ?? "").toLowerCase();
            const helper =
              get().agents.find((a) => a.name.toLowerCase() === named) ??
              get().agents.find((a) => a.id === chat.agentId) ??
              get().agents[0];
            if (!tasks.length) output = "No tasks given.";
            else if (!helper) output = "No agent configured to spawn helpers from — create one first.";
            else {
              set({ activity: `Running ${tasks.length} helpers...` });
              const results = await Promise.all(
                tasks.map((t: string) =>
                  get()
                    .runAgentTask(helper.id, t, () => {})
                    .catch((e) => `[failed] ${(e as Error).message || String(e)}`),
                ),
              );
              output = results
                .map((r, i) => `--- helper ${i + 1} (${tasks[i].slice(0, 60)}) ---\n${r}`)
                .join("\n\n");
            }
          } else {
            output = await executeTool(
              tool,
              args,
              chat.workingDir ?? "",
              mediaConfigFromSettings(settings),
              { kind: "chat", id: chat.id },
              chatSession,
            );
          }
        } catch (e) {
          output = `Error: ${(e as Error).message || String(e)}`;
        }
        const notices = takeInbox(chatSession);
        if (notices && !output.startsWith("data:")) output = `${output}\n\n${notices}`;
        const toolDur = Date.now() - toolStart;
        const att = output.startsWith("data:") ? dataUrlToAttachment(output, call.name) : null;
        if (att) {
          appendMsg({
            role: "tool",
            content: `[${att.kind} generated: ${att.name}]`,
            toolCallId: call.id,
            toolName: call.name,
            startedAt: toolStart,
            durationMs: toolDur,
            attachments: [att],
          });
        } else {
          appendMsg({
            role: "tool",
            content: output,
            toolCallId: call.id,
            toolName: call.name,
            startedAt: toolStart,
            durationMs: toolDur,
          });
        }
      }
    }
    if (reachedLimit) {
      appendMsg({
        role: "assistant",
        content:
          '_Reached the tool-step limit for this turn — the task may be unfinished. Send "continue" to keep going._',
      });
    }
    void import("./hooks").then((h) =>
      h.fireHook("turn-complete", { chatId: chat.id, chatTitle: chat.title, summary: `Turn complete in “${chat.title}”` }),
    );
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      const msg = (e as Error).message || String(e);
      set({ error: msg });
      void import("./hooks").then((h) =>
        h.fireHook("error", { chatId: chat.id, chatTitle: chat.title, error: msg, summary: `Error in “${chat.title}”: ${msg}` }),
      );
    }
    // drop the empty placeholder we appended for the reply that never arrived
    const cur = live();
    const last = cur?.messages[cur.messages.length - 1];
    if (cur && last?.role === "assistant" && !last.content && !last.toolCalls) {
      patch({ messages: cur.messages.slice(0, -1) });
    }
  } finally {
    abortController = null;
    leaveSwarm(chatSession);
    set({ streaming: false, activity: null });
    await storage.flushChatSaves(); // the turn is over — get it on disk now
  }

  // auto-title: after the first assistant reply, generate a concise title
  void maybeAutoTitle(get, provider, chat.model, chat.id);
  // passive memory: harvest durable facts in the background, no tool call needed
  void maybeHarvestMemory(get, provider, chat.model, chat.id);
  // Stage 2: in text mode, speak the reply if the user has speakReplies on.
  // The voice session handles its own queue when voice mode is on, so we
  // skip in that case to avoid two TTS pipelines fighting.
  void speakReplyIfWanted(get, chat.id);
}

/**
 * Multi-agent turn: fan the user's prompt out to every participant at once, each
 * streaming into its own author-tagged message. In `battle` mode each sees only
 * the user's turns and its own answers (independent columns); in `collab` mode
 * each sees the shared transcript (peers' output tagged, reasoning never shared)
 * plus its role brief. v1 is text/reasoning only — tools run in single-agent
 * chats, and per-participant tools are the planned next step.
 */
async function runMultiCompletion(set: Set, get: Get): Promise<void> {
  const { settings } = get();
  const chat = get().chats.find((c) => c.id === get().currentId);
  if (!chat) return;
  const mode: "battle" | "collab" = chat.mode === "battle" ? "battle" : "collab";
  const participants = (chat.participants ?? []).filter((p) => p.providerId && p.model && p.label);
  if (participants.length < 2) return runCompletion(set, get); // not enough — fall back to single

  const capped = capExceeded(settings.dailyCapUsd, settings.monthlyCapUsd);
  if (capped) {
    set({ error: capped });
    return;
  }

  abortController = new AbortController();
  set({
    streaming: true,
    error: null,
    activity: mode === "battle" ? "Running models…" : "Agents collaborating…",
  });

  const live = () => get().chats.find((c) => c.id === chat.id);
  const patch = (p: Partial<Chat>) => get().updateChatById(chat.id, p);
  const patchById = (mid: string, fn: (m: Message) => Message) => {
    const cur = live();
    if (cur) patch({ messages: cur.messages.map((m) => (m.id === mid ? fn(m) : m)) });
  };

  // Snapshot the transcript before adding placeholders — that's what each
  // participant reasons over (buildParticipantContext excludes reasoning).
  const baseMessages = live()?.messages ?? chat.messages;
  const placeholders = participants.map((p) => ({
    p,
    mid: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  }));
  patch({
    messages: [
      ...baseMessages,
      ...placeholders.map(({ p, mid }) => ({
        role: "assistant" as const,
        content: "",
        author: p.label,
        id: mid,
      })),
    ],
  });

  try {
    await Promise.all(
      placeholders.map(async ({ p, mid }) => {
        const provider = settings.providers.find((x) => x.id === p.providerId);
        if (!provider) {
          patchById(mid, (m) => ({ ...m, content: `_No provider "${p.providerId}" is configured._` }));
          return;
        }
        const others = participants.filter((x) => x.id !== p.id);
        const built = buildParticipantContext(baseMessages, p, mode, others);
        const system = [composeSystemPrompt(settings, chat), built.systemAddition]
          .filter(Boolean)
          .join("\n\n");
        try {
          const result = await streamChat({
            provider,
            model: p.model,
            system,
            messages: built.messages,
            temperature: chat.temperature,
            maxTokens: chat.maxTokens,
            tools: [],
            noThinking: p.noThinking,
            effort: p.effort,
            signal: abortController!.signal,
            onDelta: (d) => patchById(mid, (m) => ({ ...m, content: m.content + d })),
            onReasoning: (d) => patchById(mid, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + d })),
          });
          if (result.usage) {
            recordUsage(provider.id, p.model, result.usage.promptTokens, result.usage.completionTokens);
            const { promptTokens, completionTokens } = result.usage;
            patchById(mid, (m) => ({ ...m, promptTokens, completionTokens }));
          }
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            patchById(mid, (m) => ({
              ...m,
              content: m.content || `_Error: ${(e as Error).message || String(e)}_`,
            }));
          }
        }
      }),
    );
    void syncTray();
  } finally {
    abortController = null;
    set({ streaming: false, activity: null });
    await storage.flushChatSaves();
  }

  // Title from the first participant's model once the chat has a reply.
  const first = participants[0];
  const fp = settings.providers.find((x) => x.id === first.providerId);
  if (fp) void maybeAutoTitle(get, fp, first.model, chat.id);
  // Stage 2: speak the reply in text mode if the user wants it.
  void speakReplyIfWanted(get, chat.id);
}

/**
 * Passive memory write path. Runs after a turn completes, on topic drift or every
 * few turns, and never blocks the reply. Facts land in the shared global scope so
 * every future chat recalls them.
 */
async function maybeHarvestMemory(
  get: Get,
  provider: Provider,
  model: string,
  chatId: string,
): Promise<void> {
  const s = get().settings;
  if (!s.passiveMemory) return;
  const chat = get().chats.find((c) => c.id === chatId);
  if (!chat) return;
  const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return;
  try {
    const { shouldExtract, markExtracted, GLOBAL_MEMORY } = await import("./memory");
    if (!(await shouldExtract(GLOBAL_MEMORY, lastUser.content))) return;
    const transcript = chat.messages
      .filter((m) => m.role !== "tool")
      .slice(-14)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    // Each fact is filed by tier: personal facts reach global from anywhere,
    // project facts stay in the project rather than leaking into other work.
    const { extractScoped } = await import("./memoryScopes");
    await extractScoped(chat, transcript, provider, model);
    markExtracted(GLOBAL_MEMORY);
    // Ambient maintenance: rate-limited internally, so this is a no-op most turns.
    const { consolidate } = await import("./memory");
    void consolidate(GLOBAL_MEMORY, provider, model);
  } catch {
    /* memory is best-effort — never surface it as a chat failure */
  }
}

async function maybeAutoTitle(
  get: Get,
  provider: Provider,
  model: string,
  chatId: string,
): Promise<void> {
  if (get().settings.autoTitle === false) return; // opt-out: it costs a few tokens per chat
  const chat = get().chats.find((c) => c.id === chatId);
  if (!chat) return;
  const firstUser = chat.messages.find((m) => m.role === "user");
  const firstAssistant = chat.messages.find((m) => m.role === "assistant" && m.content.trim());
  // run once: exactly one assistant reply so far (the first exchange just finished)
  const assistantCount = chat.messages.filter((m) => m.role === "assistant" && m.content.trim()).length;
  if (!firstUser || !firstAssistant || assistantCount !== 1) return;
  try {
    const { chatOnce } = await import("./providers");
    const raw = await chatOnce(
      provider,
      model,
      "You write short chat titles. Reply with ONLY a title of at most 6 words, no quotes, no punctuation at the end.",
      `First message: ${firstUser.content.slice(0, 400)}\n\nTitle:`,
      new AbortController().signal,
    );
    const title = raw.trim().replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 60);
    if (title) get().renameChat(chat.id, title);
  } catch {
    /* keep the fallback title */
  }
}

/**
 * Stage 2: speak the assistant's just-completed reply in text mode if the
 * user has `speakReplies` enabled. The voice session has its own TTS path,
 * so we skip when voice mode is on — two queues fighting would be
 * worse than no audio.
 */
function speakReplyIfWanted(get: Get, chatId: string): void {
  const chat = get().chats.find((c) => c.id === chatId);
  if (!chat || chat.voiceMode) return;
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
  if (!lastAssistant) return;
  // Lazily import so the store doesn't pull in tts at startup.
  void import("./tts").then(({ maybeSpeakReply }) => {
    maybeSpeakReply(lastAssistant.content, get().settings, { voiceMode: false });
  });
}
