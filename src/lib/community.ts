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

export type CommunityKind = "skill" | "agent" | "workflow" | "schedule";
export type CommunitySort = "trending" | "recommended" | "downloaded" | "newest";

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

/** Build the JSON/markdown payload string for a given entity, cleaned for sharing. */
export function buildPayload(kind: CommunityKind, entity: unknown): string {
  if (kind === "skill") return String(entity); // already the SKILL.md markdown
  if (kind === "agent") return JSON.stringify(cleanAgentForPublish(entity as Agent));
  if (kind === "workflow") return JSON.stringify(cleanWorkflowForPublish(entity as Workflow));
  return JSON.stringify(cleanScheduleForPublish(entity as Schedule));
}

export async function communityPublish(input: {
  kind: CommunityKind;
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

  const s = JSON.parse(payload) as Schedule;
  await store.saveSchedule({ ...s, id: uid("sched"), enabled: false, nextRun: 0 });
  return `Imported schedule “${item.name}” (disabled — pick a target and model, then enable it).`;
}
