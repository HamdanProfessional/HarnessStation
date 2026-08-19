export type ProviderKind = "openai-compatible" | "anthropic" | "webllm";

export interface Provider {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string; // e.g. http://localhost:1234/v1 or https://api.anthropic.com
  apiKey: string;
  /** Extra keys tried in turn when the main one is rate-limited or rejected. */
  apiKeys?: string[];
  /** Provider ids to fall back to, in order, if this one errors before replying. */
  fallbacks?: string[];
  models: string[];
  /**
   * Extra top-level fields merged into every chat/completions request body.
   * For backends that need non-standard options (thinking switches, sampler
   * params, routing hints) without waiting for a dedicated setting.
   */
  extraBody?: Record<string, unknown>;
}

export interface Chunk {
  text: string;
  source: string;
  vector: number[];
}

export interface MemoryEntry {
  text: string;
  ts: number; // saved-at (ms)
  vector?: number[]; // optional embedding for semantic recall
}

export interface KnowledgeBase {
  id: string;
  name: string;
  /** provider + model used to embed (and to embed queries at retrieval time). */
  embedProviderId: string;
  embedModel: string;
  chunks: Chunk[];
}

/**
 * A named workspace profile: activate/deactivate whole features so the app can
 * be as minimal or as full as the task needs (inspired by "everything is a
 * plug-in"). Currently toggles which views appear in the sidebar; extensible to
 * tool sets and skills.
 */
export interface Profile {
  id: string;
  name: string;
  /** View ids hidden from the sidebar nav under this profile. */
  hiddenViews: string[];
}

export interface Settings {
  providers: Provider[];
  globalInstructions: string;
  theme: "dark" | "light" | "system";
  /** Brand accent palette. Independent of theme — a light canvas can carry any
   *  of these accents. Each palette has a dark-canvas and a light-canvas hue. */
  accent?: "indigo" | "forest" | "ember";
  /** Named feature profiles the user can switch between. */
  profiles?: Profile[];
  /** The currently active profile id (undefined = everything visible). */
  activeProfileId?: string;
  /** Optional self-hosted gateway server; general APIs proxy through it when set. */
  serverUrl?: string;
  /** Artificial Analysis API key (only used when no serverUrl). */
  aaApiKey?: string;
  /** Auto-summarize old turns when a chat grows past compactThreshold tokens. */
  autoCompact?: boolean;
  compactThreshold?: number; // approx tokens
  /** Keep the model working across many tool rounds without a manual "continue". */
  autoContinue?: boolean;
  /** Let the model switch on tools it finds itself, as long as they need no credentials. */
  autoEnableTools?: boolean;
  /** Name new chats from the first exchange. Costs a few tokens per chat; default on. */
  autoTitle?: boolean;
  /** Talking avatar (speech-to-speech) settings. */
  voice?: VoiceSettings;
  /** Stop starting requests once today's estimated spend reaches this many USD. */
  dailyCapUsd?: number;
  /** Same, for the calendar month. */
  monthlyCapUsd?: number;
  /** Keep running in the tray when the window is closed. */
  backgroundMode?: boolean;
  /** Remember facts across every chat automatically, with no memory tool calls. */
  passiveMemory?: boolean;
  /** How many recalled facts to consider per tier before trimming. */
  memoryK?: number;
  /** Share of the model's context window recalled memory may occupy (max 0.25). */
  memoryShare?: number;
  /** Embedding provider/model used for agent memory + knowledge (semantic recall). */
  embedProviderId?: string;
  embedModel?: string;
  /** Image/voice/video generation models the chat can call as tools. */
  mediaModels?: MediaModel[];
  /** Default media model id per kind, used by the generate_* tools. */
  defaultMediaIds?: { image?: string; audio?: string; video?: string; "3d"?: string };
  /**
   * Vault entries the model can *use* but never *see*. Only the metadata lives
   * here; the value is in the OS keychain (web: localStorage) keyed `vault:<ref>`.
   */
  secrets?: VaultSecret[];
  /** Remembered author name for publishing to the community library. */
  communityAuthor?: string;
  /** Fire a POST to a URL on lifecycle events (turn/tool/error/schedule). */
  webhooks?: import("./hooks").Webhook[];
  /** Tool ids that require a confirmation before the agent may run them. */
  confirmTools?: string[];
  /** Tool ids the agent is not allowed to run at all. */
  blockTools?: string[];
  /** Load AGENTS.md / AGENT.md / CLAUDE.md from the working directory into the prompt. Default on. */
  agentsFile?: boolean;
  /**
   * Sandbox preset — which tool categories may run at all:
   *   read-only       — no file writes, deletes or terminal (search/read/network still work)
   *   workspace-write — writes and commands allowed (confined to the working directory)
   *   full-access     — everything (default when unset)
   */
  toolSandbox?: "read-only" | "workspace-write" | "full-access";
  /**
   * Approval preset — when to ask before a mutating tool runs:
   *   suggest   — confirm every file write, delete or command
   *   auto-edit — auto-allow edits, confirm only terminal/deletes
   *   full-auto — never ask (default when unset)
   */
  toolApproval?: "suggest" | "auto-edit" | "full-auto";
  /** Argument-matching guardrail rules, evaluated before the simple lists. */
  guardrails?: import("./hooks").GuardrailRule[];
  /** Local OpenAI-compatible API server (desktop only): expose configured models/agents on loopback. */
  localApi?: { enabled: boolean; port?: number };
  /** Messaging channels (Telegram, Discord) that reach the agent from outside. */
  channels?: import("./channels").ChannelsSettings;
  /** Opt-in cloud sync account/session (end-to-end encrypted; keys stay local). */
  cloud?: {
    enabled: boolean;
    email?: string;
    /** Session bearer token (not the password). */
    token?: string;
    autoSync?: boolean;
    lastSyncedAt?: number;
    version?: number;
  };
}

/**
 * A saved credential the model references by name. The model gets the ref and
 * description via the list_secrets tool; when it writes `{{REF}}` into a file,
 * command or request, the app swaps in the real value at run time and redacts
 * that value from anything the model reads back — so the secret never enters
 * the transcript and can't be "leaked, rotate it".
 */
export interface VaultSecret {
  /** Placeholder name the model uses, e.g. CLOUDFLARE_API_TOKEN. `[A-Z0-9_]+`. */
  ref: string;
  /** Human label, e.g. "Cloudflare API token". */
  name: string;
  /** What it unlocks / how it should be used, shown to the model. */
  description: string;
  /** Last few characters, so the owner can tell entries apart without revealing the value. */
  hint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON string
}

export interface Attachment {
  kind: "image" | "text" | "audio" | "video";
  name: string;
  mime: string;
  /** For image/audio/video: data URL. For text: the extracted text content. */
  data: string;
}

/** How the talking avatar decides when to listen. */
export type VoiceMode = "ptt" | "auto";

export interface VoiceSettings {
  /** Provider/model for spoken replies ("" = use the current chat's). */
  providerId?: string;
  model?: string;
  mode?: VoiceMode;
  /** Windows SAPI voice name; blank = system default. Ignored when a media TTS model is set. */
  winVoice?: string;
  /** Windows SAPI speaking rate, -10..10. */
  rate?: number;
  /** Extra persona/instructions layered onto the spoken-reply system prompt. */
  instructions?: string;
  /** Mic RMS above which speech is detected (auto mode). */
  threshold?: number;
  /** Trailing silence (ms) that ends an utterance in auto mode. */
  silenceMs?: number;
  /** Speak replies aloud. */
  speakReplies?: boolean;
  /** Agent whose instructions, tools, knowledge and memory the avatar uses. */
  agentId?: string;
  /** Tool ids the avatar may call when no agent is selected. */
  toolIds?: string[];
  /** Working directory for file/terminal tools. */
  workingDir?: string;
  /** Say a short filler ("one moment") while tools run, and announce each action. */
  narrateActions?: boolean;
  /** Input device name; blank = system default. */
  micDevice?: string;
  /** Whisper model size used for speech-to-text ("tiny" | "base" | "small"). */
  sttModel?: string;
  /** Only respond when addressed with this phrase (always-listening mode). */
  wakeWord?: string;
  /** Seconds after a reply during which follow-ups skip the wake word. */
  followUpSeconds?: number;
  /** Interrupt the avatar by talking over it (headphones recommended). */
  bargeIn?: boolean;
  /** Which voice engine to speak with. "auto" picks the best already available. */
  ttsEngine?: "auto" | "windows" | "piper" | "kokoro" | "cloud";
  /** Kokoro voice id, e.g. af_heart. */
  kokoroVoice?: string;
  /** Cloud speech service, used when ttsEngine is "cloud". */
  cloud?: {
    engine: "openai" | "elevenlabs" | "cartesia" | "groq";
    apiKey: string;
    baseUrl?: string;
    model?: string;
    voice?: string;
    speed?: number;
  };
  /** VRM avatar file under ~/.harnessx/avatars. Blank = the plain orb. */
  avatarFile?: string;
  /** Piper voice id, e.g. en_US-amy-medium. */
  piperVoice?: string;
  /** Wait for you to finish a half-spoken sentence instead of cutting in at the first pause. */
  smartEndpoint?: boolean;
  /** Extra grace (ms) given when the sentence sounds unfinished. */
  holdMs?: number;
  /** Speak like a person: contractions, breath pauses, pitch movement. */
  humanDelivery?: boolean;
  /** How much pitch/rate movement to add. 0 = flat, 1 = natural, 2 = animated. */
  expressiveness?: number;
  /** Conversational persona applied to spoken replies. */
  persona?: "friendly" | "calm" | "upbeat" | "professional" | "none";
  /** Language you speak, as an ISO code — or "auto" to detect each utterance. */
  language?: string;
  /** Transcribe your speech straight into English text regardless of what you speak. */
  translateToEnglish?: boolean;
  /** Language of spoken replies: "match" follows you, or pin an ISO code. */
  replyLanguage?: string;
  /** Turn off reasoning/thinking on every model the avatar uses, for faster replies. */
  noThinking?: boolean;
  /** Show a rolling transcript while you speak. Costs extra whisper passes. */
  liveTranscript?: boolean;
  /** Run each utterance through a small model that rewrites it for speech. */
  speechRewrite?: boolean;
  /** Provider/model for that rewrite — use the smallest, fastest one you have. */
  speechProviderId?: string;
  speechModel?: string;
}

export type MediaKind = "image" | "audio" | "video" | "3d";

/** How a media model's request/response is shaped. */
export type MediaEngine =
  | "openai-image" // POST /images/generations, b64_json (OpenAI + compatible local)
  | "a1111" // local Stable Diffusion webui: POST /sdapi/v1/txt2img
  | "openai-speech" // POST /audio/speech, binary audio (OpenAI + compatible local TTS)
  | "replicate"; // generic async cloud (image / audio / video) via model version

/** A configured image/voice/video generation model the chat can call as a tool. */
export interface MediaModel {
  id: string;
  name: string;
  kind: MediaKind;
  engine: MediaEngine;
  baseUrl: string; // e.g. https://api.openai.com/v1 or http://localhost:7860
  apiKey?: string;
  model: string; // model id / replicate version / TTS voice+model
  /** extra hint: image size (1024x1024) or TTS voice, engine-dependent. */
  options?: string;
}

/**
 * The context actually fed to the model on a step — captured so the Trajectory
 * view can show exactly what the model saw (system prompt, retrieved knowledge,
 * memory) instead of just the final answer. Stored once per turn (first round)
 * to keep conversations from bloating on long tool chains.
 */
export interface MessageTrace {
  /** Fully-composed system prompt the model received this step. */
  system?: string;
  /** Injected knowledge-base retrieval text (RAG), if any. */
  rag?: string;
  /** Injected passive-memory block, if any. */
  memory?: string;
  /** Injected skill index (names + descriptions). */
  skills?: string;
  /** Injected project brief, if the chat is in a project. */
  project?: string;
  /** Injected AGENTS.md note from the working directory. */
  agentsMd?: string;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** For tool messages: the tool that produced this result (so the trajectory
   * view / export need not join back through toolCallId). */
  toolName?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Multi-agent chats: which participant produced this message (their label). Absent = single-agent or user. */
  author?: string;
  /** Transient id used to target a specific message while streaming concurrently (multi-agent). */
  id?: string;
  // ---- Trajectory / traceability (all optional; absent on older messages) ----
  /** Epoch ms when this step started (assistant stream start, or tool-call start). */
  startedAt?: number;
  /** How long this step took, in ms (stream duration, or tool execution time). */
  durationMs?: number;
  /** Tool-loop round index within the turn (0-based), for assistant messages. */
  round?: number;
  /** The context fed to the model this step (first round of a turn only). */
  trace?: MessageTrace;
}

/** A model or agent taking part in a multi-agent (battle / collaborate) chat. */
export interface Participant {
  id: string;
  /** Display name / role, e.g. "Frontend" or "Model A". */
  label: string;
  providerId: string;
  model: string;
  /** Role brief added to this participant's system prompt (collaborate mode). */
  instructions?: string;
  /** If this participant is based on a saved agent. */
  agentId?: string;
  /** Turn off this participant's reasoning/thinking — faster, cheaper replies. */
  noThinking?: boolean;
  /** Reasoning effort for this participant, when its model supports it. Absent = provider default. */
  effort?: "low" | "medium" | "high";
}

/**
 * A group of chats and calls that share memory and settings — a piece of work
 * rather than a single conversation.
 */
export interface Project {
  id: string;
  name: string;
  /** What the project is, injected into every chat inside it. */
  description: string;
  /** Extra system instructions for every chat in the project. */
  instructions: string;
  createdAt: string;
  updatedAt: string;
  /** Knowledge bases every chat in the project retrieves from. */
  knowledgeBaseIds?: string[];
  /** Tools switched on by default for new chats in the project. */
  defaultToolIds?: string[];
  color?: string;
}

export interface Chat {
  id: string;
  title: string;
  /** Legacy: pre-Stage-2 voice chats were created with kind="voice".
   *  New chats use voiceMode (a runtime toggle on any chat). The two
   *  flags can coexist — a migrated chat shows the voice icon because
   *  of kind, but voiceMode is the source of truth for whether the
   *  voice overlay is active. */
  kind?: "voice";
  /** Whether the chat is currently in voice mode (the embedded voice
   *  panel replaces the text composer). Independent of kind: any chat
   *  can be in voice mode. */
  voiceMode?: boolean;
  /** The project this belongs to, if any — decides which memory it shares. */
  projectId?: string;
  /** Turn off recalled memory for this one conversation. */
  memoryOff?: boolean;
  pinned?: boolean;
  folder?: string;
  createdAt: string;
  updatedAt: string;
  providerId: string;
  model: string;
  systemPrompt: string;
  styleId: string;
  temperature: number;
  maxTokens: number;
  enabledTools?: string[]; // tool ids usable by the model in this chat
  jsonSchema?: string; // optional JSON schema string; constrains responses when set
  knowledgeBaseId?: string; // legacy single source — migrated into knowledgeBaseIds
  knowledgeBaseIds?: string[]; // knowledge bases to retrieve relevant chunks from
  workingDir?: string; // absolute path for file/terminal tools (empty = home)
  agentId?: string; // the agent applied to this chat, if any
  /** Multi-agent mode: 'battle' = same prompt, independent answers; 'collab' = shared transcript. Default single. */
  mode?: "single" | "battle" | "collab";
  /** Extra models/agents taking part alongside the chat's own model (battle/collab). */
  participants?: Participant[];
  summary?: string; // rolling summary of messages before summaryUpto
  summaryUpto?: number; // messages[0..summaryUpto) are covered by summary
  messages: Message[];
}

export interface Preset {
  id: string;
  name: string;
  systemPrompt: string;
  styleId: string;
  temperature: number;
  maxTokens: number;
}

export interface StylePreset {
  id: string;
  name: string;
  snippet: string;
}

/** A named system-instruction template, saveable/importable as a JSON file. */
export interface Template {
  id: string;
  name: string;
  content: string;
}

/** A user tool: JS async function body executed with (args, ctx), or a Python function run via the system Python. */
export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  code: string;
  runtime?: "js" | "python"; // default js
  builtin?: boolean;
  group?: string; // display group (MCP server name, "Agents", "Workflows"...)
}

/** A named set of enabled tool ids, applyable to any chat. */
export interface ToolSet {
  id: string;
  name: string;
  toolIds: string[];
}

export type CondOp =
  | "contains"
  | "not_contains"
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "starts"
  | "ends"
  | "empty"
  | "not_empty"
  | "regex";

export interface Condition {
  left: string; // value/template to test (e.g. {{prev}}, {{steps.NAME}}, a literal)
  op: CondOp;
  right: string; // value to compare against (template allowed)
  goto: string; // step name or "end"
}

export type WorkflowStep =
  | {
      type: "prompt";
      name: string;
      instructions: string; // system prompt for this step
      prompt: string; // template: {{input}}, {{prev}}, {{steps.NAME}}
      useTools: boolean;
    }
  | {
      type: "function";
      name: string;
      toolId: string;
      args: string; // JSON template: {{input}}, {{prev}}, {{steps.NAME}}
    }
  | {
      type: "switch";
      name: string;
      cases: Condition[];
      defaultGoto: string; // step name, or "end"
    }
  | {
      type: "agent";
      name: string;
      agentId: string; // one of the user's agents
      input: string; // template passed to the agent (default {{prev}})
    }
  | {
      type: "parallel";
      name: string;
      lanes: ParallelLane[]; // run concurrently, outputs merged into this step's result
    };

/** One concurrent lane of a parallel step — either a prompt or an agent call. */
export interface ParallelLane {
  label: string; // heading used when merging lane outputs
  kind: "prompt" | "agent";
  instructions?: string; // prompt lane: system prompt
  prompt?: string; // prompt lane: template (default {{prev}})
  useTools?: boolean; // prompt lane: allow tool calling
  agentId?: string; // agent lane
  agentInput?: string; // agent lane: template (default {{prev}})
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export type Cadence =
  | { type: "interval"; minutes: number }
  | { type: "hourly"; minute: number }
  | { type: "daily"; time: string } // "HH:MM"
  | { type: "weekly"; day: number; time: string } // day 0-6 (Sun-Sat)
  | { type: "once"; at: string }; // ISO datetime

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  targetType: "agent" | "workflow";
  targetId: string;
  input: string;
  providerId: string; // for workflow runs / agent fallback
  model: string;
  cadence: Cadence;
  saveToChat: boolean; // append the run's output as a new chat
  nextRun: number; // ms timestamp
  lastRun?: number;
  lastResult?: string;
  lastError?: string;
  /** Optional webhook / Slack URL to POST the run's output to when it finishes. */
  deliverUrl?: string;
  deliverKind?: "json" | "slack";
}

export interface EvalCase {
  id: string;
  prompt: string;
  expected: string; // target text/regex, or rubric for the judge
}

export interface EvalModel {
  providerId: string;
  model: string;
}

export type EvalScoring = "none" | "contains" | "regex" | "equals" | "judge";

export interface Eval {
  id: string;
  name: string;
  system: string;
  cases: EvalCase[];
  models: EvalModel[];
  scoring: EvalScoring;
  judgeProviderId?: string;
  judgeModel?: string;
}

/** An agent: a reusable preset of instructions + tools + workflows + sub-agents it can call. */
export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string; // system prompt
  providerId: string; // "" = use the chat's current provider
  model: string; // "" = use the chat's current model
  temperature: number;
  maxTokens: number;
  toolIds: string[]; // real tool ids this agent may call
  workflowIds: string[]; // workflows exposed as callable tools
  subAgentIds: string[]; // other agents this agent may call
  knowledgeBaseIds?: string[]; // knowledge bases retrieved into the agent's context
  autoMemory?: boolean; // auto-extract durable facts after each run
}
