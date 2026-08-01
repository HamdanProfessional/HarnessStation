import {
  describeSelf,
  exportPeers,
  meshStart,
  meshStatus,
  meshStop,
  type MeshPeer,
  type MeshShare,
} from "./mesh";
import { startHost, stopHost } from "./meshHost";
import { useStore } from "./store";

/**
 * Wires the mesh to the rest of the app.
 *
 * Kept apart from `mesh.ts` (the wire) and `meshHost.ts` (the policy) because
 * this is the only piece that needs the store, the providers and the tool
 * runner — the other two stay testable without any of that.
 */

const SHARE_KEY = "hs-mesh-share";

function share(): MeshShare {
  try {
    const raw = JSON.parse(localStorage.getItem(SHARE_KEY) || "{}");
    return { models: !!raw.models, tools: !!raw.tools, knowledge: !!raw.knowledge };
  } catch {
    return { models: false, tools: false, knowledge: false };
  }
}

/**
 * Latest peer list, refreshed by the poll below.
 *
 * The host has to answer an inbound request *now*, so it can't await a status
 * round-trip to find out whether the caller is paired — hence a cache rather
 * than a lookup. A peer forgotten seconds ago could still be served from here,
 * which is why Rust checks the token independently.
 */
let peersCache: MeshPeer[] = [];
let poll: number | null = null;

/** A running log of what other devices have asked for, shown in the UI. */
const activity: string[] = [];

export function meshActivity(): string[] {
  return activity;
}

export async function startMesh(): Promise<void> {
  const store = useStore.getState();
  // Peers are remembered by Rust for the session and re-seeded here on restart,
  // so pairing survives a relaunch.
  let known: Awaited<ReturnType<typeof exportPeers>> = [];
  try {
    known = JSON.parse(localStorage.getItem("hs-mesh-peers") || "[]");
  } catch {
    /* start with none */
  }
  await meshStart(known);

  poll = window.setInterval(() => {
    void meshStatus()
      .then((s) => {
        peersCache = s.peers;
      })
      .catch(() => {});
  }, 5000);
  try {
    peersCache = (await meshStatus()).peers;
  } catch {
    /* the listener may not be up yet; the poll will catch it */
  }

  await startHost({
    share,
    peers: () => peersCache,

    describe: () =>
      describeSelf(
        useStore.getState().settings,
        useStore.getState().allTools(),
        useStore.getState().knowledgeBases.map((k) => k.name),
        share(),
      ),

    ask: async (prompt, model) => {
      const { settings } = useStore.getState();
      // "Provider / model" is what describe() advertises; fall back to the first
      // provider that has a model configured.
      const [wantProvider, wantModel] = (model ?? "").split(" / ").map((s) => s.trim());
      const provider =
        settings.providers.find((p) => p.name === wantProvider) ??
        settings.providers.find((p) => (p.models ?? []).length > 0);
      if (!provider) throw new Error("this device has no model provider configured");
      const chosen = wantModel || provider.models?.[0];
      if (!chosen) throw new Error("this device has no model configured");

      const { chatOnce } = await import("./providers/index");
      return chatOnce(
        provider,
        chosen,
        settings.globalInstructions || "",
        prompt,
        new AbortController().signal,
      );
    },

    runTool: async (id, args) => {
      const tool = useStore.getState().allTools().find((t) => t.id === id);
      if (!tool) throw new Error(`no tool "${id}" on this device`);
      const { executeTool } = await import("./tools");
      return executeTool(tool, args);
    },

    searchKnowledge: async (query) => {
      await store.ensureKnowledgeBases();
      const { knowledgeBases, settings } = useStore.getState();
      const { retrieveMultiContext } = await import("./rag");
      const text = await retrieveMultiContext(knowledgeBases, query, (kb) =>
        settings.providers.find((p) => p.id === (kb.embedProviderId || settings.embedProviderId)),
      );
      return text || "Nothing relevant found on that device.";
    },

    onActivity: (line) => {
      activity.push(`${new Date().toISOString().slice(11, 19)}  ${line}`);
      // A log nobody reads shouldn't grow without bound.
      if (activity.length > 200) activity.splice(0, activity.length - 200);
    },
  });
}

export async function stopMesh(): Promise<void> {
  if (poll) clearInterval(poll);
  poll = null;
  peersCache = [];
  await stopHost();
  await meshStop();
}

/** Persist the peer list so pairings survive a restart. */
export async function saveMeshPeers(): Promise<void> {
  try {
    const peers = await exportPeers();
    localStorage.setItem("hs-mesh-peers", JSON.stringify(peers));
  } catch {
    /* nothing to save */
  }
}
