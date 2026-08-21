import { useStore } from "../lib/store";
import { ModelOptions } from "./ModelOptions";
import type { Participant } from "../lib/types";
import { IconChat, IconColumns, IconFlow, IconPlus, IconX } from "./icons";

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const LABELS = ["Model A", "Model B", "Model C", "Model D", "Model E"];
const MAX_PARTICIPANTS = 5;

/**
 * The three modes, with the icon and the one-line explanation for each.
 *
 * The icons are the layout each mode produces rather than decoration: Battle
 * splits the transcript into side-by-side columns, which is what IconColumns
 * draws, and Collaborate joins separate models into one thread, which is what
 * IconFlow draws. Someone who has used the app once can pick the mode without
 * reading the label.
 *
 * The notes used to live inside the segmented control as a sibling of the
 * buttons, which put running prose inside the pill track — the control drew its
 * own background behind the sentence and stretched to fit it. They belong
 * beside the control, not in it.
 */
const MODES = [
  {
    id: "single",
    label: "Single",
    Icon: IconChat,
    note: "one model, one thread",
  },
  {
    id: "battle",
    label: "Battle",
    Icon: IconColumns,
    note: "same prompt → each model answers independently",
  },
  {
    id: "collab",
    label: "Collaborate",
    Icon: IconFlow,
    note: "shared transcript, private thinking, parallel roles",
  },
] as const;

/**
 * The multi-agent control at the top of a chat: pick Single / Battle /
 * Collaborate, and (when multi) manage the participants — each a model + role.
 * Battle sends the same prompt to each independently; Collaborate shares one
 * transcript (peers' output visible, thinking private) with per-role briefs.
 */
export function MultiAgentBar() {
  const { chats, currentId, settings, agents, updateChat } = useStore();
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
  // Back a participant with a saved agent: adopt its name, model and role brief.
  const pickAgent = (p: Participant, agentId: string) => {
    if (!agentId) return updateP(p.id, { agentId: undefined });
    const a = agents.find((x) => x.id === agentId);
    if (!a) return;
    updateP(p.id, {
      agentId,
      label: a.name.slice(0, 24) || p.label,
      providerId: a.providerId || p.providerId,
      model: a.model || p.model,
      instructions: a.instructions?.trim() || p.instructions,
    });
  };
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
      <div className="ma-head">
        {/* A tablist rather than a row of buttons: these select between three
            views of the same chat, and a screen reader should say "2 of 3"
            rather than announcing three unrelated controls. */}
        <div className="seg ma-seg" role="tablist" aria-label="Conversation mode">
          {MODES.map(({ id, label, Icon, note }) => (
            <button
              key={id}
              role="tab"
              aria-selected={mode === id}
              title={note}
              className={`seg-btn ${mode === id ? "active" : ""}`}
              onClick={() => setMode(id)}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <span className="ma-note">{MODES.find((m) => m.id === mode)?.note}</span>
        {mode !== "single" && (
          <span className="ma-count">
            {participants.length} model{participants.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {mode !== "single" && (
        <div className="participant-list">
          {participants.map((p, i) => {
            const models = modelsFor(p.providerId);
            return (
              // Two rows rather than one wrapping line. Five unlabelled selects
              // in a row wrapped mid-control at most window widths, so which
              // dropdown belonged to which participant was down to how the line
              // happened to break.
              <div key={p.id} className="participant-chip">
                <div className="p-head">
                  {/* The letter is the participant's position, which is also
                      the order the battle columns appear in. */}
                  <span className="p-badge" aria-hidden="true">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <input
                    className="p-label"
                    value={p.label}
                    placeholder="Name"
                    aria-label={`Name for participant ${i + 1}`}
                    onChange={(e) => updateP(p.id, { label: e.target.value })}
                  />
                  {participants.length > 2 && (
                    <button className="icon-btn" title={`Remove ${p.label}`} onClick={() => removeP(p.id)}>
                      <IconX size={12} />
                    </button>
                  )}
                </div>

                <div className="p-fields">
                  {agents.length > 0 && (
                    <select
                      className="p-agent"
                      title="Base this participant on a saved agent"
                      aria-label="Saved agent"
                      value={p.agentId ?? ""}
                      onChange={(e) => pickAgent(p, e.target.value)}
                    >
                      <option value="">— model —</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    aria-label="Provider"
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
                  <select
                    className="p-model"
                    aria-label="Model"
                    value={p.model}
                    onChange={(e) => updateP(p.id, { model: e.target.value })}
                  >
                    <ModelOptions models={models} />
                    {p.model && !models.includes(p.model) && <option value={p.model}>{p.model}</option>}
                  </select>
                  <select
                    className="p-effort"
                    title="Reasoning effort (models that support it)"
                    aria-label="Reasoning effort"
                    disabled={p.noThinking}
                    value={p.effort ?? ""}
                    onChange={(e) =>
                      updateP(p.id, { effort: (e.target.value || undefined) as Participant["effort"] })
                    }
                  >
                    <option value="">effort: auto</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                  <label className="p-think" title="Turn off this participant's thinking">
                    <input
                      type="checkbox"
                      checked={!!p.noThinking}
                      onChange={(e) => updateP(p.id, { noThinking: e.target.checked })}
                    />
                    no&nbsp;think
                  </label>
                </div>

                {mode === "collab" && (
                  <input
                    className="p-role"
                    value={p.instructions ?? ""}
                    placeholder="role / task (e.g. frontend)"
                    aria-label={`Role for ${p.label}`}
                    onChange={(e) => updateP(p.id, { instructions: e.target.value })}
                  />
                )}
              </div>
            );
          })}
          {participants.length < MAX_PARTICIPANTS && (
            <button className="btn small" onClick={addP}>
              <IconPlus size={12} /> Add
            </button>
          )}
        </div>
      )}
    </div>
  );
}
