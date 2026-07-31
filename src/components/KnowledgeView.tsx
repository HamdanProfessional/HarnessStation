import { useEffect, useRef, useState } from "react";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { fileToAttachment } from "../lib/attach";
import { chunkText, embed } from "../lib/rag";
import { useStore } from "../lib/store";
import type { Chunk, KnowledgeBase } from "../lib/types";
import { EmptyState } from "./EmptyState";
import { IconBook } from "./icons";

export function KnowledgeView() {
  const { knowledgeBases, saveKnowledgeBase, deleteKnowledgeBase, settings, ensureKnowledgeBases } =
    useStore();

  // Vectors load lazily, so pull them in when this view is actually opened.
  useEffect(() => {
    void ensureKnowledgeBases();
  }, [ensureKnowledgeBases]);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [embProvider, setEmbProvider] = useState(settings.providers[0]?.id ?? "");
  const [embModel, setEmbModel] = useState("text-embedding-3-small");
  const fileRef = useRef<HTMLInputElement>(null);
  const targetKb = useRef<string | null>(null);

  const createKb = async () => {
    const name = await promptDialog("New knowledge base", { placeholder: "Name" });
    if (!name?.trim()) return;
    const kb: KnowledgeBase = {
      id: `kb-${Date.now()}`,
      name: name.trim(),
      embedProviderId: embProvider,
      embedModel: embModel,
      chunks: [],
    };
    await saveKnowledgeBase(kb);
  };

  const addFiles = async (kb: KnowledgeBase, files: FileList | null) => {
    if (!files?.length) return;
    const provider = settings.providers.find((p) => p.id === kb.embedProviderId);
    if (!provider) {
      setError("This knowledge base's embedding provider is missing — recreate it.");
      return;
    }
    setBusy(kb.id);
    setError(null);
    try {
      const newChunks: Chunk[] = [];
      for (const f of Array.from(files)) {
        setStatus(`Reading ${f.name}...`);
        const att = await fileToAttachment(f);
        if (att.kind !== "text") continue;
        const pieces = chunkText(att.data, f.name);
        // embed in batches of 32
        for (let i = 0; i < pieces.length; i += 32) {
          const batch = pieces.slice(i, i + 32);
          setStatus(`Embedding ${f.name} (${i + batch.length}/${pieces.length})...`);
          const vectors = await embed(provider, kb.embedModel, batch.map((b) => b.text));
          batch.forEach((b, j) => newChunks.push({ text: b.text, source: b.source, vector: vectors[j] }));
        }
      }
      await saveKnowledgeBase({ ...kb, chunks: [...kb.chunks, ...newChunks] });
      setStatus(`Added ${newChunks.length} chunks.`);
      setTimeout(() => setStatus(null), 2500);
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Knowledge</h1>
        <button className="btn primary" onClick={() => void createKb()}>
          New knowledge base
        </button>
      </div>
      <p className="hint">
        Add documents to a knowledge base; HarnessStation embeds them locally and retrieves the most
        relevant passages into context when you attach the base to a chat (right panel). Needs a
        provider with an embeddings endpoint.
      </p>

      <div className="provider-row">
        <label className="field grow">
          <span>Default embedding provider</span>
          <select value={embProvider} onChange={(e) => setEmbProvider(e.target.value)}>
            {settings.providers
              .filter((p) => p.kind === "openai-compatible")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field grow">
          <span>Embedding model</span>
          <input value={embModel} onChange={(e) => setEmbModel(e.target.value)} placeholder="e.g. text-embedding-3-small, nomic-embed-text" />
        </label>
      </div>
      <p className="hint">
        Common: OpenAI <code>text-embedding-3-small</code>, Ollama <code>nomic-embed-text</code>, or an
        embedding GGUF served locally.
      </p>

      {status && <p className="hint">{status}</p>}
      {error && <div className="error-banner">{error}</div>}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".txt,.md,.csv,.json,.js,.ts,.py,.html,.css,.pdf,.log,.xml,.yaml,.yml"
        style={{ display: "none" }}
        onChange={(e) => {
          const kb = knowledgeBases.find((k) => k.id === targetKb.current);
          if (kb) void addFiles(kb, e.target.files);
          e.target.value = "";
        }}
      />

      {knowledgeBases.map((kb) => (
        <div key={kb.id} className="provider-card">
          <div className="provider-row">
            <div className="grow">
              <b>{kb.name}</b>{" "}
              <span className="hint">
                {kb.chunks.length} chunks · {kb.embedModel}
              </span>
            </div>
            <button
              className="btn small"
              disabled={busy === kb.id}
              onClick={() => {
                targetKb.current = kb.id;
                fileRef.current?.click();
              }}
            >
              {busy === kb.id ? "Embedding..." : "Add documents"}
            </button>
            <button
              className="icon-btn"
              onClick={async () => {
                if (await confirmDialog(`Delete knowledge base ${kb.name}?`, { danger: true }))
                  void deleteKnowledgeBase(kb.id);
              }}
            >
              x
            </button>
          </div>
          {kb.chunks.length > 0 && (
            <div className="hint">
              Sources: {[...new Set(kb.chunks.map((c) => c.source))].join(", ")}
            </div>
          )}
        </div>
      ))}
      {knowledgeBases.length === 0 && (
        <EmptyState
          icon={<IconBook size={22} />}
          title="No knowledge bases yet"
          hint="Add documents the model can search and cite in chats and agents."
          action={{ label: "New knowledge base", onClick: () => void createKb() }}
        />
      )}
    </main>
  );
}
