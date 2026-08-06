import { useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../lib/useModal";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";
import {
  buildPayload,
  communityPublish,
  type TemplatePayload,
  type TemplateSubtype,
} from "../lib/community";
import { BUILTIN_TOOLS } from "../lib/tools";

/**
 * Builder for the community "template" kind — the composed one. A template is
 * either a runnable **setup** (instructions + default tools, optionally bundling
 * an agent or a workflow) that imports as a project, or a **ui** code snippet
 * others copy/export. Provider, model and local ids are stripped before sending.
 *
 * The other kinds (skill/agent/workflow/schedule) publish from their own views
 * via PublishButton; templates get their own builder because they're composed.
 */
export function TemplatePublish({
  onClose,
  onPublished,
}: {
  onClose: () => void;
  onPublished?: () => void;
}) {
  const { settings, saveSettings, agents, workflows, customTools, mcpTools } = useStore();
  const [subtype, setSubtype] = useState<TemplateSubtype>("setup");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState(settings.communityAuthor ?? "");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  // setup fields
  const [instructions, setInstructions] = useState("");
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [starters, setStarters] = useState("");
  const [agentId, setAgentId] = useState("");
  const [workflowId, setWorkflowId] = useState("");

  // ui fields
  const [framework, setFramework] = useState("React + Tailwind");
  const [code, setCode] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [previewImage, setPreviewImage] = useState("");

  const ref = useModal(true, onClose);
  const realTools = [...BUILTIN_TOOLS, ...customTools, ...mcpTools];
  const toggleTool = (id: string) =>
    setToolIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error("Give it a name (at least 2 characters).");
      return;
    }
    let payloadObj: TemplatePayload;
    if (subtype === "ui") {
      if (!code.trim()) {
        toast.error("Paste the component code.");
        return;
      }
      payloadObj = {
        subtype: "ui",
        framework: framework.trim(),
        code,
        dependencies: dependencies.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean),
        previewImage: previewImage.trim() || undefined,
      };
    } else {
      const agent = agentId ? agents.find((a) => a.id === agentId) ?? null : null;
      const workflow = workflowId ? workflows.find((w) => w.id === workflowId) ?? null : null;
      if (!instructions.trim() && toolIds.length === 0 && !agent && !workflow) {
        toast.error("A setup template needs at least instructions, a tool, an agent, or a workflow.");
        return;
      }
      payloadObj = {
        subtype: "setup",
        instructions,
        toolIds,
        starters: starters.split("\n").map((s) => s.trim()).filter(Boolean),
        agent,
        workflow,
      };
    }
    setBusy(true);
    try {
      const payload = buildPayload("template", payloadObj);
      const tagList = tags
        .split(/[,\s]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8);
      await communityPublish({
        kind: "template",
        subtype,
        name: name.trim(),
        description: description.trim(),
        author: author.trim(),
        tags: tagList,
        payload,
      });
      if (author.trim() && author.trim() !== settings.communityAuthor) {
        await saveSettings({ ...useStore.getState().settings, communityAuthor: author.trim() });
      }
      toast.success(`Published “${name.trim()}” to the community library.`);
      onPublished?.();
      onClose();
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Publish a template"
        tabIndex={-1}
        style={{ width: "min(720px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Publish a template</h3>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button
            className={`seg-btn ${subtype === "setup" ? "active" : ""}`}
            onClick={() => setSubtype("setup")}
          >
            Setup (starter-kit)
          </button>
          <button
            className={`seg-btn ${subtype === "ui" ? "active" : ""}`}
            onClick={() => setSubtype("ui")}
          >
            UI (code snippet)
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          {subtype === "setup"
            ? "A runnable starter-kit — imports as a project with your instructions and default tools, plus any bundled agent or workflow. Provider, model and local ids are stripped before sending."
            : "A UI code snippet others copy or export into their own project. We don't run JSX in-app, so add a preview image URL if you have one."}
        </p>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
        </label>
        <div className="provider-row">
          <label className="field grow">
            <span>Your name (optional)</span>
            <input value={author} placeholder="Anonymous" onChange={(e) => setAuthor(e.target.value)} maxLength={40} />
          </label>
          <label className="field grow">
            <span>Tags (comma separated)</span>
            <input value={tags} placeholder="support, coding" onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>

        {subtype === "setup" ? (
          <>
            <label className="field">
              <span>System instructions</span>
              <textarea
                rows={5}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="How the assistant should behave in this project…"
              />
            </label>
            <label className="field">
              <span>Starter prompts (one per line, optional)</span>
              <textarea
                rows={3}
                value={starters}
                onChange={(e) => setStarters(e.target.value)}
                placeholder={"Summarise this ticket\nDraft a friendly reply"}
              />
            </label>
            <div className="provider-row">
              <label className="field grow">
                <span>Bundle an agent (optional)</span>
                <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">— none —</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field grow">
                <span>Bundle a workflow (optional)</span>
                <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
                  <option value="">— none —</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <section>
              <h2 style={{ fontSize: 14 }}>Default tools</h2>
              <div className="agent-check-grid">
                {realTools.map((t) => (
                  <label key={t.id} className="agent-check">
                    <input type="checkbox" checked={toolIds.includes(t.id)} onChange={() => toggleTool(t.id)} />
                    {t.name.replace(/_/g, " ")}
                  </label>
                ))}
              </div>
            </section>
          </>
        ) : (
          <>
            <div className="provider-row">
              <label className="field grow">
                <span>Framework</span>
                <input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="React + Tailwind" />
              </label>
              <label className="field grow">
                <span>Preview image URL (optional)</span>
                <input value={previewImage} onChange={(e) => setPreviewImage(e.target.value)} placeholder="https://…" />
              </label>
            </div>
            <label className="field">
              <span>Dependencies (comma separated, optional)</span>
              <input
                value={dependencies}
                onChange={(e) => setDependencies(e.target.value)}
                placeholder="framer-motion, lucide-react"
              />
            </label>
            <label className="field">
              <span>Component code</span>
              <textarea
                rows={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="export function Pricing() { … }"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              />
            </label>
          </>
        )}

        <div className="provider-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
