import { create } from "zustand";
import { streamChat } from "./providers";
import * as storage from "./storage";
import { composeSystemPrompt } from "./styles";
import { BUILTIN_TOOLS, executeTool } from "./tools";
import { runAgent, syntheticTools } from "./agents";
import { runWorkflow } from "./workflow";
import { computeNextRun } from "./schedule";
import { retrieveMultiContext } from "./rag";
import { mediaConfigFromSettings, dataUrlToAttachment } from "./media";
import { skillIndexPrompt } from "./skills";
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
    enabledTools: [],
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
  | "mcp";

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
  saveSettings: (s: Settings) => Promise<void>;
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
  exportChat: (id: string, format: "md" | "json") => Promise<string>;
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

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  view: "chat",
  settings: storage.DEFAULT_SETTINGS,
  chats: [],
  messageCounts: {},
  hydratedIds: {},
  pendingVoiceChat: null,
  activeVoiceChat: null,
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
      storage.loadSettings(),
      storage.loadChatIndex(),
      storage.loadPresets(),
      storage.listTemplates(),
      storage.listTools(),
      storage.listWorkflows(),
      storage.listToolSets(),
      storage.listAgents(),
      storage.listSchedules(),
      storage.listProjects(),
      import("./skills").then((m) => m.listSkills()),
      storage.listEvals(),
      import("./platform").then((m) => m.detectOs()),
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
    });
  },

  setView: (view) => set({ view }),

  saveSettings: async (settings) => {
    set({ settings });
    await storage.saveSettings(settings);
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
    const body = await storage.loadChatBody(id);
    set({
      // Marked even when the read failed: a missing file has nothing more to give,
      // and retrying on every keystroke would be worse than showing it empty.
      hydratedIds: { ...get().hydratedIds, [id]: true },
      chats: body
        ? get().chats.map((c) => (c.id === id ? { ...body, ...c, messages: body.messages } : c))
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
        return body ? { ...body, ...c, messages: body.messages } : c;
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
    if (attachments?.length) userMsg.attachments = attachments;
    const patch: Partial<Chat> = {
      messages: [...chat.messages, userMsg],
    };
    if (chat.messages.length === 0) {
      patch.title = text.length > 42 ? `${text.slice(0, 42)}...` : text;
    }
    get().updateChat(patch);
    await runCompletion(set, get);
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

  stop: () => abortController?.abort(),

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
    if (cur) patch({ messages: [...cur.messages, m] });
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
    if (est > (settings.compactThreshold ?? 8000)) {
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

      const result = await streamChat({
        provider,
        model: chat.model,
        system: [
          composeSystemPrompt(settings, base),
          projectNote,
          skillIndex,
          memoryBlock,
          ragContext,
          summaryNote,
        ]
          .filter(Boolean)
          .join("\n\n"),
        messages: history,
        temperature: chat.temperature,
        maxTokens: chat.maxTokens,
        tools: enabledTools,
        jsonSchema: chat.jsonSchema,
        signal: abortController.signal,
        onDelta: (delta) => patchLast((m) => ({ ...m, content: m.content + delta })),
        onReasoning: (delta) => patchLast((m) => ({ ...m, reasoning: (m.reasoning ?? "") + delta })),
      });

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
        const att = output.startsWith("data:") ? dataUrlToAttachment(output, call.name) : null;
        if (att) {
          appendMsg({
            role: "tool",
            content: `[${att.kind} generated: ${att.name}]`,
            toolCallId: call.id,
            attachments: [att],
          });
        } else {
          appendMsg({ role: "tool", content: output, toolCallId: call.id });
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
  } catch (e) {
    if ((e as Error).name !== "AbortError") {
      set({ error: (e as Error).message || String(e) });
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
