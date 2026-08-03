import { useMemo, useState } from "react";
import { useStore } from "../lib/store";
import { normalizeRef } from "../lib/secrets";
import { confirmDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import { IconX } from "./icons";

/**
 * The secrets vault UI. You save a credential here; the model can reference it
 * by name but never read its value, and the value never enters a chat. See
 * secrets.ts for the mechanism.
 */
export function SecretsPanel() {
  const { settings, saveSecret, deleteSecret } = useStore();
  const secrets = settings.secrets ?? [];

  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [refTouched, setRefTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // ref being edited
  const [busy, setBusy] = useState(false);

  // The ref auto-fills from the name (CLOUDFLARE_API_TOKEN) until you edit it.
  const effectiveRef = refTouched ? normalizeRef(ref) : normalizeRef(name);
  const dup = useMemo(
    () => !editing && secrets.some((s) => s.ref === effectiveRef),
    [editing, secrets, effectiveRef],
  );
  const canSave = !!name.trim() && !!effectiveRef && !dup && (!!editing || !!value.trim());

  const reset = () => {
    setName("");
    setRef("");
    setRefTouched(false);
    setDescription("");
    setValue("");
    setEditing(null);
  };

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await saveSecret({ ref: effectiveRef, name: name.trim(), description: description.trim() }, value);
      toast.success(editing ? "Secret updated" : `Saved {{${effectiveRef}}}`);
      reset();
    } catch (e) {
      toast.error(`Could not save secret: ${(e as Error).message || String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (s: (typeof secrets)[number]) => {
    setEditing(s.ref);
    setName(s.name);
    setRef(s.ref);
    setRefTouched(true);
    setDescription(s.description);
    setValue(""); // never prefilled — we can't read it, and blank means "keep it"
  };

  const remove = async (r: string) => {
    if (await confirmDialog(`Delete secret {{${r}}}? Anything relying on it will stop working.`, { danger: true })) {
      await deleteSecret(r);
    }
  };

  return (
    <>
      <h2>Secrets</h2>
      <p className="hint">
        Save API keys and tokens the assistant can <em>use</em> but never <em>read</em>. The value is
        stored in your OS keychain — never in a chat, a file the app writes, or the cloud. In a chat
        the model sees only the name and description (via the <code>list_secrets</code> tool); when it
        writes a placeholder like <code>{"{{CLOUDFLARE_API_TOKEN}}"}</code> into a file, command or
        request, the app swaps in the real value at the last moment and scrubs it from anything the
        model reads back. That way a provider never sees the key in your transcript and can't flag it
        as leaked.
      </p>

      <section className="provider-card">
        <h3 style={{ marginTop: 0 }}>{editing ? `Edit ${editing}` : "Add a secret"}</h3>
        <div className="provider-row">
          <label className="field grow">
            <span>Name</span>
            <input
              placeholder="e.g. Cloudflare API token"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field grow">
            <span>Reference (used in chat)</span>
            <input
              placeholder="CLOUDFLARE_API_TOKEN"
              value={effectiveRef}
              disabled={!!editing}
              onChange={(e) => {
                setRefTouched(true);
                setRef(e.target.value);
              }}
            />
          </label>
        </div>
        {dup && <small className="field-error">A secret with that reference already exists.</small>}
        <label className="field">
          <span>Description (shown to the model)</span>
          <textarea
            rows={2}
            placeholder="What this key is for and what it can do, e.g. 'Edits DNS records and Workers for my account.'"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            Value{" "}
            {editing && <small className="hint">— leave blank to keep the current value</small>}
          </span>
          <input
            type="password"
            autoComplete="off"
            placeholder={editing ? "•••••••• (unchanged)" : "Paste the key/token"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="provider-row">
          <button className="btn primary" disabled={!canSave || busy} onClick={() => void submit()}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add secret"}
          </button>
          {editing && (
            <button className="btn" onClick={reset}>
              Cancel
            </button>
          )}
          {!editing && effectiveRef && (
            <span className="hint" style={{ alignSelf: "center" }}>
              Reference it in chat as <code>{`{{${effectiveRef}}}`}</code>
            </span>
          )}
        </div>
      </section>

      <h3>Saved secrets</h3>
      {secrets.length === 0 ? (
        <p className="hint">Nothing saved yet.</p>
      ) : (
        secrets.map((s) => (
          <div key={s.ref} className="provider-card">
            <div className="provider-row">
              <div className="grow">
                <b>{s.name}</b>{" "}
                <code className="tool-tag">{`{{${s.ref}}}`}</code>{" "}
                {s.hint && <span className="hint">ends ••{s.hint}</span>}
                {s.description && <div className="hint">{s.description}</div>}
              </div>
              <button className="btn small" onClick={() => startEdit(s)}>
                Edit
              </button>
              <button
                className="icon-btn"
                title={`Delete ${s.name}`}
                aria-label={`Delete ${s.name}`}
                onClick={() => void remove(s.ref)}
              >
                <IconX size={14} />
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
