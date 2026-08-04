import { useState } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../lib/useModal";
import { useStore } from "../lib/store";
import { toast } from "../lib/toast";
import { buildPayload, communityAvailable, communityPublish, type CommunityKind } from "../lib/community";
import { IconUpload } from "./icons";

/**
 * "Publish to community" control, reused by the Skills / Agents / Workflows /
 * Schedules views. Opens a small form (name, description, author, tags), builds
 * a share-clean payload from the entity and uploads it to the gateway. The
 * author name is remembered in settings so it's typed once.
 */
export function PublishButton({
  kind,
  defaultName,
  defaultDescription,
  getEntity,
  className = "link-btn",
  label = "Publish",
}: {
  kind: CommunityKind;
  defaultName: string;
  defaultDescription: string;
  /** Returns the entity to publish: the SKILL.md markdown for a skill, else the object. */
  getEntity: () => Promise<unknown> | unknown;
  className?: string;
  label?: string;
}) {
  const { settings, saveSettings } = useStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState(defaultDescription);
  const [author, setAuthor] = useState(settings.communityAuthor ?? "");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useModal(open, () => setOpen(false));

  if (!communityAvailable()) return null;

  const openForm = () => {
    setName(defaultName);
    setDescription(defaultDescription);
    setAuthor(useStore.getState().settings.communityAuthor ?? "");
    setTags("");
    setOpen(true);
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error("Give it a name (at least 2 characters).");
      return;
    }
    setBusy(true);
    try {
      const entity = await getEntity();
      const payload = buildPayload(kind, entity);
      const tagList = tags.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8);
      await communityPublish({
        kind,
        name: name.trim(),
        description: description.trim(),
        author: author.trim(),
        tags: tagList,
        payload,
      });
      // Remember the author name for next time.
      if (author.trim() && author.trim() !== settings.communityAuthor) {
        await saveSettings({ ...useStore.getState().settings, communityAuthor: author.trim() });
      }
      toast.success(`Published “${name.trim()}” to the community library.`);
      setOpen(false);
    } catch (e) {
      toast.error(`Publish failed: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={className} onClick={openForm} title="Share this with the community">
        {className.includes("icon") ? <IconUpload size={14} /> : label}
      </button>
      {open &&
        createPortal(
          <div className="modal-backdrop" onClick={() => setOpen(false)}>
            <div
              className="modal"
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label="Publish to community"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
            >
              <h3>Publish to community</h3>
              <p className="hint" style={{ marginTop: 0 }}>
                Shared publicly and free for anyone to import. Machine-specific bits (your provider,
                model{kind !== "skill" ? ", and local references" : ""}) are stripped before it's sent —
                no keys ever leave your machine.
              </p>
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </label>
              <label className="field">
                <span>Description</span>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={600} />
              </label>
              <div className="provider-row">
                <label className="field grow">
                  <span>Your name (optional)</span>
                  <input value={author} placeholder="Anonymous" onChange={(e) => setAuthor(e.target.value)} maxLength={40} />
                </label>
                <label className="field grow">
                  <span>Tags (comma separated)</span>
                  <input value={tags} placeholder="coding, research" onChange={(e) => setTags(e.target.value)} />
                </label>
              </div>
              <div className="provider-row" style={{ justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={busy} onClick={() => void submit()}>
                  {busy ? "Publishing…" : "Publish"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
