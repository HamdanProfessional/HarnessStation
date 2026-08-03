import { IconChevron } from "./icons";
import { useEffect, useState } from "react";
import { promptDialog } from "../lib/dialog";
import { prettyName } from "../lib/format";
import { listModels } from "../lib/providers";
import { useStore } from "../lib/store";
import { STYLE_PRESETS } from "../lib/styles";
import { BUILTIN_TOOLSETS } from "../lib/tools";
import { buildShareLink } from "../lib/deeplink";
import { toast } from "../lib/toast";

export function ConfigPanel() {
  const {
    chats,
    currentId,
    settings,
    updateChat,
    presets,
    savePresetFromChat,
    applyPreset,
    deletePreset,
    templates,
    saveTemplate,
    deleteTemplate,
    allTools,
    toolSets,
    saveToolSet,
    deleteToolSet,
    knowledgeBases,
    ensureKnowledgeBases,
    projects,
    agents,
    applyAgentToChat,
    activity,
    streaming,
    setView,
  } = useStore();

  // Knowledge bases load on demand — this picker is one of the triggers.
  useEffect(() => {
    void ensureKnowledgeBases();
  }, [ensureKnowledgeBases]);
  const chat = chats.find((c) => c.id === currentId);
  const projectOfChat = chat?.projectId ? projects.find((p) => p.id === chat.projectId) : undefined;
  const [loadingModels, setLoadingModels] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [modelError, setModelError] = useState<string | null>(null);
  const [shareKey, setShareKey] = useState(false);

  const copyShareLink = async () => {
    const link = buildShareLink({ includeKey: shareKey });
    try {
      await navigator.clipboard.writeText(link);
      toast.success(
        shareKey
          ? "Link copied — it contains this provider's API key, so share it only with people you trust."
          : "Share link copied to clipboard.",
      );
    } catch {
      // Clipboard can be blocked (no focus / insecure context) — show it to copy by hand.
      await promptDialog("Copy this link", { defaultValue: link });
    }
  };
  if (!chat) return null;

  const provider = settings.providers.find((p) => p.id === chat.providerId);

  const refreshModels = async () => {
    if (!provider || provider.kind !== "openai-compatible") return;
    setLoadingModels(true);
    setModelError(null);
    try {
      const models = await listModels(provider);
      const saved = { ...settings };
      const target = saved.providers.find((p) => p.id === provider.id);
      if (target) target.models = models;
      await useStore.getState().saveSettings(saved);
      if (models.length && !models.includes(chat.model)) updateChat({ model: models[0] });
    } catch (e) {
      const msg = (e as Error).message || String(e);
      setModelError(
        msg.includes("error sending request")
          ? `Could not reach ${provider.baseUrl} — is the server running?`
          : `Could not list models: ${msg}`,
      );
    } finally {
      setLoadingModels(false);
    }
  };

  const activeAgent = chat.agentId ? agents.find((a) => a.id === chat.agentId) : undefined;

  return (
    <aside className="config-panel">
      {streaming && (
        <div className="activity-bar">
          <span className="activity-dot" />
          <span className="activity-text">{activity ?? "Working..."}</span>
        </div>
      )}

      <label className="field">
        <span>Agent</span>
        <select
          value={chat.agentId ?? ""}
          onChange={(e) => {
            if (e.target.value) applyAgentToChat(e.target.value);
            else updateChat({ agentId: undefined });
          }}
        >
          <option value="">None (manual)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {activeAgent && (
          <div className="agent-active">
            <span className="hint">
              {activeAgent.toolIds.length + activeAgent.subAgentIds.length + activeAgent.workflowIds.length} capabilities ·
              instructions &amp; tools set by this agent
            </span>
            <div className="preset-row">
              <button className="link-btn" onClick={() => setView("agents")}>
                edit agent
              </button>
              <button className="link-btn" onClick={() => updateChat({ agentId: undefined })}>
                detach
              </button>
            </div>
          </div>
        )}
      </label>

      <label className="field">
        <span>Provider</span>
        <select
          value={chat.providerId}
          onChange={(e) => {
            const p = settings.providers.find((x) => x.id === e.target.value);
            updateChat({ providerId: e.target.value, model: p?.models[0] ?? "" });
          }}
        >
          {settings.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>
          Model{" "}
          {provider?.kind === "openai-compatible" && (
            <button className="link-btn" onClick={() => void refreshModels()} disabled={loadingModels}>
              {loadingModels ? "loading…" : "refresh"}
            </button>
          )}
        </span>
        {provider && provider.models.length > 0 ? (
          <select value={chat.model} onChange={(e) => updateChat({ model: e.target.value })}>
            {!provider.models.includes(chat.model) && chat.model && (
              <option value={chat.model}>{chat.model}</option>
            )}
            {provider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={chat.model}
            placeholder="model name"
            onChange={(e) => updateChat({ model: e.target.value })}
          />
        )}
        {modelError && <small className="field-error">{modelError}</small>}
      </label>

      <label className="field">
        <span>
          Preset{" "}
          <button
            className="link-btn"
            onClick={async () => {
              const name = await promptDialog("Save preset", { placeholder: "Preset name" });
              if (name?.trim()) void savePresetFromChat(name.trim());
            }}
            title="Save current system prompt + parameters as a preset"
          >
            save current
          </button>
        </span>
        <div className="preset-row">
          <select
            className="grow"
            value=""
            onChange={(e) => e.target.value && applyPreset(e.target.value)}
          >
            <option value="">Apply a preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {presets.length > 0 && (
            <button
              className="icon-btn"
              title="Delete a preset"
              onClick={async () => {
                const name = await promptDialog("Delete preset", {
                  message: `Type the preset name to delete: ${presets.map((p) => p.name).join(", ")}`,
                });
                const target = presets.find((p) => p.name === name?.trim());
                if (target) void deletePreset(target.id);
              }}
            >
              ×
            </button>
          )}
        </div>
      </label>

      <label className="field">
        <span>Style</span>
        <select value={chat.styleId} onChange={(e) => updateChat({ styleId: e.target.value })}>
          {STYLE_PRESETS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>
          Share setup{" "}
          <button className="link-btn" onClick={() => void copyShareLink()}>
            copy link
          </button>
        </span>
        <small className="hint">
          A link that opens the app on this provider, model and style
          {chat.kind === "voice" ? ", in voice mode" : ""}.
        </small>
        <label
          className="hint"
          style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}
          title="Include this provider's API key in the link so the recipient needs no key of their own. Anyone with the link can then use the key."
        >
          <input type="checkbox" checked={shareKey} onChange={(e) => setShareKey(e.target.checked)} />
          Include API key (insecure — for trials only)
        </label>
      </div>

      <label className="field">
        <span>
          System prompt (this chat){" "}
          <button
            className="link-btn"
            title="Save current instructions as a template"
            onClick={async () => {
              if (!chat.systemPrompt.trim()) return;
              const name = await promptDialog("Save template", { placeholder: "Template name" });
              if (name?.trim()) void saveTemplate(name.trim(), chat.systemPrompt);
            }}
          >
            save as template
          </button>
        </span>
        <textarea
          rows={6}
          value={chat.systemPrompt}
          placeholder="Extra instructions for this chat..."
          onChange={(e) => updateChat({ systemPrompt: e.target.value })}
        />
        {templates.length > 0 && (
          <div className="preset-row">
            <select
              className="grow"
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) updateChat({ systemPrompt: t.content });
              }}
            >
              <option value="">Apply a template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="icon-btn"
              title="Delete a template"
              onClick={async () => {
                const name = await promptDialog("Delete template", {
                  message: `Type the template name to delete: ${templates.map((t) => t.name).join(", ")}`,
                });
                const target = templates.find((t) => t.name === name?.trim());
                if (target) void deleteTemplate(target.id);
              }}
            >
              x
            </button>
          </div>
        )}
        <small className="hint">Templates are JSON files in ~\.harnessx\templates (drop files there to import).</small>
      </label>

      {provider?.kind === "openai-compatible" &&
        (() => {
          const tools = allTools();
          const enabled = new Set(chat.enabledTools ?? []);
          const toggle = (id: string) => {
            const cur = new Set(enabled);
            cur.has(id) ? cur.delete(id) : cur.add(id);
            updateChat({ enabledTools: [...cur] });
          };
          return (
            <div className="field">
              <div className="tools-header">
                <span>Tools</span>
                <span className="tools-count">{enabled.size}/{tools.length}</span>
              </div>
              <div className="tools-actions">
                <button
                  className="link-btn"
                  onClick={() => updateChat({ enabledTools: tools.map((t) => t.id) })}
                >
                  All
                </button>
                <button className="link-btn" onClick={() => updateChat({ enabledTools: [] })}>
                  None
                </button>
                <button
                  className="link-btn"
                  title="Save enabled tools as a named set"
                  onClick={async () => {
                    if (!enabled.size) return;
                    const name = await promptDialog("Save tool set", { placeholder: "Tool set name" });
                    if (name?.trim()) void saveToolSet(name.trim(), [...enabled]);
                  }}
                >
                  Save set
                </button>
              </div>

              {(() => {
                const allSets = [...BUILTIN_TOOLSETS, ...toolSets];
                return (
                <div className="preset-row">
                  <select
                    className="grow"
                    value=""
                    onChange={(e) => {
                      const set = allSets.find((t) => t.id === e.target.value);
                      if (set) {
                        const known = tools.map((t) => t.id);
                        updateChat({ enabledTools: set.toolIds.filter((id) => known.includes(id)) });
                      }
                    }}
                  >
                    <option value="">Apply a tool set...</option>
                    <optgroup label="Built-in">
                      {BUILTIN_TOOLSETS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.toolIds.length})
                        </option>
                      ))}
                    </optgroup>
                    {toolSets.length > 0 && (
                      <optgroup label="Yours">
                        {toolSets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.toolIds.length})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    className="icon-btn"
                    title="Delete a tool set"
                    onClick={async () => {
                      const name = await promptDialog("Delete tool set", {
                        message: `Type the tool set name to delete: ${toolSets.map((t) => t.name).join(", ")}`,
                      });
                      const target = toolSets.find((t) => t.name === name?.trim());
                      if (target) void deleteToolSet(target.id);
                    }}
                  >
                    x
                  </button>
                </div>
                );
              })()}

              {(() => {
                const groupOf = (t: (typeof tools)[number]) =>
                  t.group ?? (t.runtime === "python" ? "Python" : t.builtin ? "System" : "Custom");
                const order = ["System", "Custom", "Python", "Agents", "Workflows"];
                const groups = new Map<string, typeof tools>();
                for (const t of tools) {
                  const g = groupOf(t);
                  if (!groups.has(g)) groups.set(g, []);
                  groups.get(g)!.push(t);
                }
                const names = [...groups.keys()].sort((a, b) => {
                  const ia = order.indexOf(a);
                  const ib = order.indexOf(b);
                  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
                });
                const setGroup = (list: typeof tools, on: boolean) => {
                  const cur = new Set(enabled);
                  list.forEach((t) => (on ? cur.add(t.id) : cur.delete(t.id)));
                  updateChat({ enabledTools: [...cur] });
                };
                const stripPrefix = (name: string, group: string) => {
                  const label = prettyName(name);
                  const gp = prettyName(group) + " ";
                  return label.startsWith(gp) ? label.slice(gp.length) : label;
                };
                return names.map((g) => {
                  const list = groups.get(g)!;
                  const onCount = list.filter((t) => enabled.has(t.id)).length;
                  const open = openGroups[g] ?? (list.length <= 8 && g !== "Agents" && g !== "Workflows");
                  return (
                    <div key={g} className="tool-group">
                      <div className="tool-group-head">
                        <button
                          className="tool-group-title"
                          onClick={() => setOpenGroups((s) => ({ ...s, [g]: !open }))}
                        >
                          <span className={`nav-caret ${open ? "" : "closed"}`}>
                            <IconChevron size={12} />
                          </span>
                          {g}
                          <span className="tool-group-count">
                            {onCount}/{list.length}
                          </span>
                        </button>
                        <span
                          className={`switch sm ${onCount === list.length ? "on" : ""}`}
                          title="Toggle all in group"
                          onClick={() => setGroup(list, onCount !== list.length)}
                        >
                          <span className="knob" />
                        </span>
                      </div>
                      {open && (
                        <div className="tool-list">
                          {list.map((t) => {
                            const on = enabled.has(t.id);
                            return (
                              <button
                                key={t.id}
                                className={`tool-row ${on ? "on" : ""}`}
                                title={t.description || t.name}
                                onClick={() => toggle(t.id)}
                              >
                                <span className={`switch ${on ? "on" : ""}`}>
                                  <span className="knob" />
                                </span>
                                <span className="tool-row-name">{stripPrefix(t.name, g)}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          );
        })()}

      {(() => {
        const fsIds = [
          "create_folder",
          "write_file",
          "read_file",
          "delete_path",
          "list_folder",
          "find_files",
          "run_terminal",
        ];
        const usesFs = chat.enabledTools?.some((id) => fsIds.includes(id));
        if (!usesFs) return null;
        return (
          <label className="field">
            <span>Working directory</span>
            <input
              value={chat.workingDir ?? ""}
              placeholder="e.g. C:\\Users\\you\\Desktop\\project (blank = home)"
              onChange={(e) => updateChat({ workingDir: e.target.value })}
            />
            <small className="hint">
              File and terminal tools run here. Relative paths the model uses (e.g. <code>notes/a.txt</code>)
              resolve against this folder.
            </small>
          </label>
        );
      })()}

      {/* Memory can be switched off per conversation: a big store on a small
          local model is the difference between a slow answer and a failed one. */}
      <label className="agent-check" title="Recalled memory for this conversation">
        <input
          type="checkbox"
          checked={!chat.memoryOff}
          onChange={(e) => updateChat({ memoryOff: !e.target.checked })}
        />
        Use remembered facts here
      </label>
      {chat.memoryOff && (
        <small className="hint" style={{ marginBottom: 12, display: "block" }}>
          This chat runs with no recalled memory. It still learns — facts are saved as usual.
        </small>
      )}

      {projectOfChat && (
        <small className="hint" style={{ marginBottom: 12, display: "block" }}>
          In project <b>{projectOfChat.name}</b> — shares that project's memory with its other
          chats and calls.
        </small>
      )}

      {knowledgeBases.length > 0 && (() => {
        const selected = chat.knowledgeBaseIds ?? (chat.knowledgeBaseId ? [chat.knowledgeBaseId] : []);
        const toggle = (id: string) => {
          const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
          updateChat({ knowledgeBaseIds: next, knowledgeBaseId: undefined });
        };
        return (
          <label className="field">
            <span>Knowledge sources {selected.length > 0 ? `(${selected.length})` : ""}</span>
            <div className="agent-check-grid">
              {knowledgeBases.map((k) => (
                <label key={k.id} className="agent-check">
                  <input type="checkbox" checked={selected.includes(k.id)} onChange={() => toggle(k.id)} />
                  {k.name} ({k.chunks.length})
                </label>
              ))}
            </div>
          </label>
        );
      })()}

      <label className="field">
        <span>Temperature: {chat.temperature.toFixed(1)}</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={chat.temperature}
          onChange={(e) => updateChat({ temperature: Number(e.target.value) })}
        />
      </label>

      <label className="field">
        <span>Max tokens (0 = default)</span>
        <input
          type="number"
          min={0}
          value={chat.maxTokens}
          onChange={(e) => updateChat({ maxTokens: Number(e.target.value) || 0 })}
        />
      </label>

      {provider?.kind === "openai-compatible" && (
        <label className="field">
          <span>
            Structured output{" "}
            <button
              className="link-btn"
              title="Insert an example JSON schema"
              onClick={() =>
                updateChat({
                  jsonSchema: JSON.stringify(
                    {
                      type: "object",
                      properties: { answer: { type: "string" }, confidence: { type: "number" } },
                      required: ["answer"],
                      additionalProperties: false,
                    },
                    null,
                    2,
                  ),
                })
              }
            >
              example
            </button>
            {chat.jsonSchema ? (
              <button className="link-btn" onClick={() => updateChat({ jsonSchema: "" })}>
                {" "}clear
              </button>
            ) : null}
          </span>
          <textarea
            rows={5}
            className="code"
            value={chat.jsonSchema ?? ""}
            placeholder="Optional JSON schema — responses are constrained to match it"
            onChange={(e) => updateChat({ jsonSchema: e.target.value })}
          />
          {chat.jsonSchema?.trim() && !isValidJson(chat.jsonSchema) && (
            <small className="field-error">Not valid JSON — will be ignored until fixed.</small>
          )}
        </label>
      )}
    </aside>
  );
}

function isValidJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
