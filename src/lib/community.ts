/**
 * Community library client: browse, like, download and publish user-made Skills,
 * Agents, Workflows and Schedules through the gateway.
 *
 * There are no accounts. Publishing is anonymous with a chosen author name; a
 * like is keyed to a hashed IP server-side so one visitor counts once. Imported
 * items are sanitised of machine-specific ids (provider/model, local references)
 * so someone else's agent lands usable on your setup.
 */
import { gatewayUrl } from "./gateway";
import { useStore } from "./store";
import type { Agent, Schedule, Workflow } from "./types";

export type CommunityKind = "skill" | "agent" | "workflow" | "schedule" | "template";
export type CommunitySort = "trending" | "recommended" | "downloaded" | "newest";

/** Templates come in two shapes: a runnable starter-kit, or a UI code snippet. */
export type TemplateSubtype = "setup" | "ui";

/** A starter-kit: instructions + default tools, optionally bundling an agent/workflow. */
export interface TemplateSetup {
  subtype: "setup";
  instructions?: string;
  toolIds?: string[];
  starters?: string[];
  agent?: Agent | null;
  workflow?: Workflow | null;
}
/** A UI snippet the importer copies/exports (we don't run arbitrary JSX in-app). */
export interface TemplateUi {
  subtype: "ui";
  framework?: string;
  code: string;
  dependencies?: string[];
  previewImage?: string;
}
export type TemplatePayload = TemplateSetup | TemplateUi;

export interface CommunityItem {
  id: string;
  type: CommunityKind;
  name: string;
  description: string;
  author: string;
  tags: string[];
  createdAt: number;
  downloads: number;
  likes: number;
  liked: boolean;
  /** Present only on templates: which shape this is. */
  subtype?: TemplateSubtype;
}

export interface CommunityList {
  items: CommunityItem[];
  total: number;
  tags: string[];
}

/** The gateway base, or null when this build has none configured. */
function base(): string | null {
  return gatewayUrl();
}

export function communityAvailable(): boolean {
  return !!base();
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const b = base();
  if (!b) throw new Error("The community library needs the HarnessStation gateway, which isn't configured in this build.");
  const res = await fetch(`${b}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* non-JSON error */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function communityList(opts: {
  kind?: CommunityKind | "all";
  sort?: CommunitySort;
  q?: string;
  tag?: string;
}): Promise<CommunityList> {
  const p = new URLSearchParams();
  p.set("type", opts.kind ?? "all");
  p.set("sort", opts.sort ?? "trending");
  if (opts.q?.trim()) p.set("q", opts.q.trim());
  if (opts.tag) p.set("tag", opts.tag);
  return api<CommunityList>(`/api/library?${p.toString()}`);
}

export async function communityLike(id: string): Promise<{ likes: number; liked: boolean }> {
  return api(`/api/library/${id}/like`, { method: "POST" });
}

/** Flag an item for moderation. Enough distinct reports auto-hide it for review. */
export async function communityReport(id: string, reason: string): Promise<void> {
  await api(`/api/library/${id}/report`, { method: "POST", body: JSON.stringify({ reason }) });
}

// ---------- moderation (admin token required) ----------

export interface AdminItem {
  id: string;
  type: CommunityKind;
  name: string;
  author: string;
  createdAt: number;
  downloads: number;
  likes: number;
  hidden: boolean;
  reportCount: number;
  reasons: string[];
}

/** Full listing incl. hidden items and report reasons. Needs the admin bearer token. */
export async function communityAdminList(token: string): Promise<AdminItem[]> {
  return api<AdminItem[]>(`/api/admin/library`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Hide, restore, or permanently remove an item. */
export async function communityAdminAct(
  token: string,
  id: string,
  action: "hide" | "restore" | "remove",
): Promise<void> {
  await api(`/api/admin/library/${id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action }),
  });
}

/** Fetch the payload (counts as a download) so it can be imported. */
async function fetchPayload(id: string): Promise<string> {
  const { payload } = await api<{ payload: string }>(`/api/library/${id}/download`, { method: "POST" });
  return payload;
}

// ---------- publishing ----------

/** Random id for imported entities (avoids colliding with the author's ids). */
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip an agent of machine-local references before it's shared. */
function cleanAgentForPublish(a: Agent): Agent {
  return {
    ...a,
    id: "",
    providerId: "", // "" = use the importer's current provider
    model: "",
    // Built-in tool ids are stable across installs, so they travel; per-user
    // references (other workflows / sub-agents / knowledge bases) can't resolve
    // elsewhere, so they're dropped rather than shipped broken.
    workflowIds: [],
    subAgentIds: [],
    knowledgeBaseIds: [],
  };
}

function cleanWorkflowForPublish(w: Workflow): Workflow {
  return { ...w, id: "" };
}

function cleanScheduleForPublish(s: Schedule): Schedule {
  return {
    ...s,
    id: "",
    enabled: false,
    targetId: "", // the importer wires it to one of their own agents/workflows
    providerId: "",
    model: "",
    nextRun: 0,
    lastRun: undefined,
    lastResult: undefined,
    lastError: undefined,
  };
}

/** Strip machine-local ids from anything a setup template bundles. */
function cleanTemplateForPublish(t: TemplatePayload): TemplatePayload {
  if (t.subtype === "ui") {
    return {
      subtype: "ui",
      framework: t.framework || "",
      code: t.code,
      dependencies: t.dependencies ?? [],
      ...(t.previewImage ? { previewImage: t.previewImage } : {}),
    };
  }
  return {
    subtype: "setup",
    instructions: t.instructions || "",
    toolIds: t.toolIds ?? [],
    starters: (t.starters ?? []).filter(Boolean),
    agent: t.agent ? cleanAgentForPublish(t.agent) : null,
    workflow: t.workflow ? cleanWorkflowForPublish(t.workflow) : null,
  };
}

/** Build the JSON/markdown payload string for a given entity, cleaned for sharing. */
export function buildPayload(kind: CommunityKind, entity: unknown): string {
  if (kind === "skill") return String(entity); // already the SKILL.md markdown
  if (kind === "agent") return JSON.stringify(cleanAgentForPublish(entity as Agent));
  if (kind === "workflow") return JSON.stringify(cleanWorkflowForPublish(entity as Workflow));
  if (kind === "schedule") return JSON.stringify(cleanScheduleForPublish(entity as Schedule));
  return JSON.stringify(cleanTemplateForPublish(entity as TemplatePayload));
}

export async function communityPublish(input: {
  kind: CommunityKind;
  subtype?: TemplateSubtype;
  name: string;
  description: string;
  author: string;
  tags: string[];
  payload: string;
}): Promise<CommunityItem> {
  return api<CommunityItem>(`/api/library/publish`, {
    method: "POST",
    body: JSON.stringify({
      type: input.kind,
      subtype: input.subtype,
      name: input.name,
      description: input.description,
      author: input.author,
      tags: input.tags,
      payload: input.payload,
    }),
  });
}

// ---------- importing ----------

/** Download an item and add it to the user's local collection. Returns a label. */
export async function communityImport(item: CommunityItem): Promise<string> {
  const payload = await fetchPayload(item.id);
  const store = useStore.getState();

  if (item.type === "skill") {
    const { saveSkill, slugify, listSkills } = await import("./skills");
    const slug = slugify(item.name);
    await saveSkill(slug, payload);
    useStore.setState({ skills: await listSkills() });
    return `Imported skill “${item.name}”.`;
  }

  if (item.type === "agent") {
    const a = JSON.parse(payload) as Agent;
    await store.saveAgent({ ...a, id: uid("agent"), providerId: a.providerId || "", model: a.model || "" });
    return `Imported agent “${item.name}”. Set its model in Agents if needed.`;
  }

  if (item.type === "workflow") {
    const w = JSON.parse(payload) as Workflow;
    await store.saveWorkflow({ ...w, id: uid("wf") });
    return `Imported workflow “${item.name}”.`;
  }

  if (item.type === "template") {
    const t = JSON.parse(payload) as TemplatePayload;
    if (t.subtype !== "setup") {
      // UI templates aren't imported into the app; the card offers copy/export.
      throw new Error('This is a UI template — use “Copy code” or “Export” instead of Import.');
    }
    const bundled: string[] = [];
    if (t.agent) {
      await store.saveAgent({ ...t.agent, id: uid("agent"), providerId: t.agent.providerId || "", model: t.agent.model || "" });
      bundled.push("an agent");
    }
    if (t.workflow) {
      await store.saveWorkflow({ ...t.workflow, id: uid("wf") });
      bundled.push("a workflow");
    }
    // The project ties it together (instructions + default tools). Starter
    // prompts, if any, are appended so the model sees suggested openers.
    const starters = (t.starters ?? []).filter(Boolean);
    const instructions = `${(t.instructions ?? "").trim()}${
      starters.length ? `\n\n## Starter prompts\n${starters.map((p) => `- ${p}`).join("\n")}` : ""
    }`.trim();
    const now = new Date().toISOString();
    await store.saveProject({
      id: uid("proj"),
      name: item.name,
      description: item.description || "",
      instructions,
      defaultToolIds: t.toolIds ?? [],
      createdAt: now,
      updatedAt: now,
    });
    const extra = bundled.length ? ` plus ${bundled.join(" and ")}` : "";
    return `Imported template “${item.name}” as a project${extra}. Open Projects to use it.`;
  }

  const s = JSON.parse(payload) as Schedule;
  await store.saveSchedule({ ...s, id: uid("sched"), enabled: false, nextRun: 0 });
  return `Imported schedule “${item.name}” (disabled — pick a target and model, then enable it).`;
}

/** Fetch a UI template's code (counts as a download) so the UI can copy/export it. */
export async function fetchTemplate(item: CommunityItem): Promise<TemplatePayload> {
  return JSON.parse(await fetchPayload(item.id)) as TemplatePayload;
}
