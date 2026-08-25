import { embed } from "./rag";
import type { Provider } from "./types";

/**
 * Shared embeddings plumbing.
 *
 * Memory recall, knowledge retrieval and chat search all need the same two
 * things: the provider/model configured for embeddings, and a forgiving call
 * that degrades to null instead of throwing when embeddings aren't available.
 * These were private copies in each module; they live here once so the
 * fallback contract has a single definition.
 */

export function cosine(a: number[], b: number[]): number {
  let d = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export async function embedConfig(): Promise<{ provider?: Provider; model?: string }> {
  // Lazy import breaks the cycle store -> memory -> embeddings -> store.
  const { useStore } = await import("./store");
  const s = useStore.getState().settings;
  const provider = s.providers.find((p) => p.id === s.embedProviderId);
  return { provider, model: s.embedModel };
}

/** Embed texts if an embedding provider/model is configured; else null (keyword fallback). */
export async function tryEmbed(texts: string[]): Promise<number[][] | null> {
  const { provider, model } = await embedConfig();
  if (!provider || !model?.trim()) return null;
  try {
    return await embed(provider, model, texts);
  } catch {
    return null; // a bad endpoint degrades recall quality, never breaks the feature
  }
}
