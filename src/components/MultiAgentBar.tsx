import { useStore } from "../lib/store";
import type { Participant } from "../lib/types";
import { IconPlus, IconX } from "./icons";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const LABELS = ["Model A", "Model B", "Model C", "Model D"];

/**
 * The multi-agent control at the top of a chat: pick Single / Battle /
 * Collaborate, and (when multi) manage the participants — each a model + role.
 * Battle sends the same prompt to each independently; Collaborate shares one
 * transcript (peers' output visible, thinking private) with per-role briefs.
 */
export function MultiAgentBar() {
  const { chats, currentId, settings, updateChat } = useStore();
  const chat = chats.find((c) => c.id === currentId);
  if (!chat) return null;
  const providers = settings.providers;
  const mode = chat.mode ?? "single";
  const participants = chat.participants ?? [];

  const seed = (): Participant[] => {
    const p0 = providers.find((x) => x.id === chat.providerId) ?? providers[0];
    const a: Participant = {
      id: uid(),
      label: "Model A",
      providerId: chat.providerId || p0?.id || "",
      model: chat.model || p0?.models[0] || "",
    };
    const b: Participant = {
      id: uid(),
      label: "Model B",
      providerId: p0?.id ?? a.providerId,
      model: p0?.models[1] ?? p0?.models[0] ?? a.model,
    };
    return [a, b];
  };

  const setMode = (m: "single" | "battle" | "collab") => {
    if (m === "single") return updateChat({ mode: "single" });
    updateChat({ mode: m, participants: participants.length >= 2 ? participants : seed() });
  };

  const updateP = (id: string, patch: Partial<Participant>) =>
    updateChat({ participants: participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const removeP = (id: string) => updateChat({ participants: participants.filter((p) => p.id !== id) });
  const addP = () => {
    const pr = providers[0];
    updateChat({
      participants: [
        ...participants,
        { id: uid(), label: LABELS[participants.length] ?? `Model ${participants.length + 1}`, providerId: pr?.id ?? "", model: pr?.models[0] ?? "" },
      ],
    });
  };

  const modelsFor = (providerId: string) => providers.find((x) => x.id === providerId)?.models ?? [];

  return (
    <div className="multiagent-bar">
      <div className="seg small">
        {(["single", "battle", "collab"] as const).map((m) => (
          <button key={m} className={`seg-btn ${mode === m ? "active" : ""}`} onClick={() => setMode(m)}>
            {m === "single" ? "Single" : m === "battle" ? "Battle" : "Collaborate"}
          </button>
        ))}
        {mode !== "single" && (
          <span className="hint multiagent-note">
            {mode === "battle"
              ? "same prompt → each model answers independently"
              : "shared transcript, private thinking, parallel roles"}
          </span>
        )}
      </div>

      {mode !== "single" && (
        <div className="participant-list">
          {participants.map((p) => {
            const models = modelsFor(p.providerId);
            return (
              <div key={p.id} className="participant-chip">
                <input
                  className="p-label"
                  value={p.label}
                  placeholder="Name"
                  onChange={(e) => updateP(p.id, { label: e.target.value })}
                />
                <select
                  value={p.providerId}
                  onChange={(e) => {
                    const pr = providers.find((x) => x.id === e.target.value);
                    updateP(p.id, { providerId: e.target.value, model: pr?.models[0] ?? p.model });
                  }}
                >
                  {providers.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name}
                    </option>
                  ))}
                </select>
                <select value={p.model} onChange={(e) => updateP(p.id, { model: e.target.value })}>
                  {models.map((mo) => (
                    <option key={mo} value={mo}>
                      {mo}
                    </option>
                  ))}
                  {p.model && !models.includes(p.model) && <option value={p.model}>{p.model}</option>}
                </select>
                {mode === "collab" && (
                  <input
                    className="p-role"
                    value={p.instructions ?? ""}
                    placeholder="role / task (e.g. frontend)"
                    onChange={(e) => updateP(p.id, { instructions: e.target.value })}
                  />
                )}
                {participants.length > 2 && (
                  <button className="icon-btn" title={`Remove ${p.label}`} onClick={() => removeP(p.id)}>
                    <IconX size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {participants.length < 4 && (
            <button className="btn small" onClick={addP}>
              <IconPlus size={12} /> Add
            </button>
          )}
        </div>
      )}
    </div>
  );
}
