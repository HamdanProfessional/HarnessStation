import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../lib/useModal";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";
import {
  buildBundlePayload,
  buildPayload,
  communityPublish,
  type BundleItem,
  type BundleableKind,
} from "../lib/community";
import { listSkills, readSkillRaw } from "../lib/skills";

/** One selectable local entity, tagged with its kind and how to build its payload. */
interface Row {
  key: string;
  kind: BundleableKind;
  name: string;
  description: string;
  /** Produces the share-clean payload for this entity when selected. */
  payload: () => Promise<string> | string;
}

/**
 * Publish a bundle — pick several of your own skills, agents, workflows and
 * schedules and share them as one versioned, installable package. Each member is
 * cleaned of machine-local ids the same way a single publish is.
 */
export function BundlePublish({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  const { settings, saveSettings, agents, workflows, schedules } = useStore();
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState(settings.communityAuthor ?? "");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useModal(true, onClose);

  useEffect(() => {
    let live = true;
    (async () => {
      const skills = await listSkills();
      if (!live) return;
      const list: Row[] = [
        ...skills.map((s) => ({
          key: `skill:${s.slug}`,
          kind: "skill" as const,
          name: s.name,
          description: s.description,
          payload: () => readSkillRaw(s.slug),
        })),
        ...agents.map((a) => ({
          key: `agent:${a.id}`,
          kind: "agent" as const,
          name: a.name,
          description: a.description,
          payload: () => buildPayload("agent", a),
        })),
        ...workflows.map((w) => ({
          key: `workflow:${w.id}`,
          kind: "workflow" as const,
          name: w.name,
          description: w.description,
          payload: () => buildPayload("workflow", w),
        })),
        ...schedules.map((s) => ({
          key: `schedule:${s.id}`,
          kind: "schedule" as const,
          name: s.name,
          description: "",
          payload: () => buildPayload("schedule", s),
        })),
      ];
      setRows(list);
    })();
    return () => {
      live = false;
    };
  }, [agents, workflows, schedules]);

  const toggle = (key: string) =>
    setPicked((p) => {
      const next = new Set(p);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const submit = async () => {
    if (name.trim().length < 2) return toast.error("Give the bundle a name (at least 2 characters).");
    const chosen = rows.filter((r) => picked.has(r.key));
    if (chosen.length < 2) return toast.error("Pick at least two items to bundle.");
    setBusy(true);
    try {
      const items: BundleItem[] = [];
      for (const r of chosen) {
        items.push({ kind: r.kind, name: r.name, description: r.description, payload: await r.payload() });
      }
      const tagList = tags.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
      await communityPublish({
        kind: "bundle",
        name: name.trim(),
        description: description.trim(),
        author: author.trim(),
        tags: tagList,
        payload: buildBundlePayload(items),
      });
      if (author.trim() && author.trim() !== settings.communityAuthor) {
        await saveSettings({ ...useStore.getState().settings, communityAuthor: author.trim() });
      }
      toast.success(`Published bundle “${name.trim()}” (${items.length} items).`);
      onPublished();
      onClose();
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const KIND_TAG: Record<BundleableKind, string> = {
    skill: "Skill",
    agent: "Agent",
    workflow: "Workflow",
    schedule: "Schedule",
    template: "Template",
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Publish a bundle"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Publish a bundle</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Package several of your skills, agents, workflows and schedules as one installable set. Machine-specific
          bits (provider, model, local references) are stripped from each before it's sent.
        </p>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Research starter kit" />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
        </label>

        <div className="field">
          <span>Items ({picked.size} selected)</span>
          <div className="bundle-picker">
            {rows.length === 0 ? (
              <p className="hint">You have nothing to bundle yet — make some skills, agents or workflows first.</p>
            ) : (
              rows.map((r) => (
                <label key={r.key} className="bundle-row">
                  <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
                  <span className="tool-tag">{KIND_TAG[r.kind]}</span>
                  <span className="grow">
                    <b>{r.name}</b>
                    {r.description ? <span className="hint"> — {r.description}</span> : null}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="provider-row">
          <label className="field grow">
            <span>Your name (optional)</span>
            <input value={author} placeholder="Anonymous" onChange={(e) => setAuthor(e.target.value)} maxLength={40} />
          </label>
          <label className="field grow">
            <span>Tags (comma separated)</span>
            <input value={tags} placeholder="research, coding" onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>

        <div className="provider-row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || picked.size < 2} onClick={() => void submit()}>
            {busy ? "Publishing…" : `Publish bundle`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
