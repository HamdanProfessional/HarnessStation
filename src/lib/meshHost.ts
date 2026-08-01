import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  authorize,
  describeSelf,
  remotelySafe,
  replyTo,
  type InboundRequest,
  type MeshPeer,
  type MeshShare,
} from "./mesh";

/**
 * Serves requests from other devices.
 *
 * Runs for as long as the mesh is on, listening for the `mesh-request` events
 * Rust emits when a paired peer calls in. Every request is authorised against
 * the user's sharing rules first, and *every* path replies — a request left
 * unanswered would hang the caller until its timeout, which looks like a broken
 * network rather than a refused permission.
 */

let stop: UnlistenFn | null = null;

export interface HostContext {
  share: () => MeshShare;
  peers: () => MeshPeer[];
  /** Called when a peer asks this device to run a model. */
  ask: (prompt: string, model?: string) => Promise<string>;
  runTool: (id: string, args: Record<string, unknown>) => Promise<string>;
  searchKnowledge: (query: string) => Promise<string>;
  describe: () => ReturnType<typeof describeSelf>;
  /** Surfaced in the UI so the user can see what their devices are doing. */
  onActivity?: (line: string) => void;
}

export async function startHost(ctx: HostContext): Promise<void> {
  await stopHost();
  stop = await listen<InboundRequest>("mesh-request", (event) => {
    void handle(ctx, event.payload);
  });
}

export async function stopHost(): Promise<void> {
  stop?.();
  stop = null;
}

export function hostRunning(): boolean {
  return stop !== null;
}

async function handle(ctx: HostContext, req: InboundRequest): Promise<void> {
  const label = `${req.peerName} → ${req.method}`;
  try {
    const refusal = authorize(req, ctx.share(), ctx.peers());
    if (refusal) {
      ctx.onActivity?.(`${label}: refused (${refusal})`);
      await replyTo(req.rid, null, refusal);
      return;
    }

    const result = await run(ctx, req);
    ctx.onActivity?.(`${label}: ok`);
    await replyTo(req.rid, result);
  } catch (e) {
    const message = (e as Error).message || String(e);
    ctx.onActivity?.(`${label}: failed — ${message}`);
    // Report the failure rather than letting the peer time out.
    await replyTo(req.rid, null, message).catch(() => {});
  }
}

async function run(ctx: HostContext, req: InboundRequest): Promise<unknown> {
  const params = req.params ?? {};
  switch (req.method) {
    case "describe":
      return ctx.describe();

    case "ask": {
      const prompt = String(params.prompt ?? "");
      if (!prompt.trim()) throw new Error("no prompt given");
      return { text: await ctx.ask(prompt, params.model ? String(params.model) : undefined) };
    }

    case "run_tool": {
      const id = String(params.id ?? "");
      // Re-check here as well as in describe(): the shared list is a snapshot the
      // peer cached, and the user may have changed their mind since.
      if (!id) throw new Error("no tool id given");
      const shared = ctx.describe().tools;
      if (!shared.includes(id)) throw new Error(`that device isn't sharing "${id}"`);
      return { output: await ctx.runTool(id, (params.args ?? {}) as Record<string, unknown>) };
    }

    case "search_knowledge": {
      const query = String(params.query ?? "");
      if (!query.trim()) throw new Error("no query given");
      return { text: await ctx.searchKnowledge(query) };
    }

    default:
      throw new Error(`unknown request "${req.method}"`);
  }
}

export { remotelySafe };
