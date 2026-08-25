import { promptDialog } from "../lib/dialog";
import { toast } from "../lib/toast";
import { applySnippet, type SnippetTrigger } from "../lib/snippets";
import type { Template } from "../lib/types";
import { IconX } from "./icons";

/** How many options the picker shows — the composer's keyboard nav wraps within the same bound. */
export const SNIPPET_PICKER_MAX = 12;

/**
 * The "/" picker: saved templates and snippets, listed above the composer
 * while a trigger is active. State lives in the composer — it owns the keydown
 * handler (ArrowUp/Down move, Enter/Tab accept, Escape closes), so this
 * component only renders the list and handles clicks.
 *
 * Mouse events use onMouseDown rather than onClick so accepting doesn't first
 * blur the textarea — the composer refocuses itself after an insert anyway,
 * but preventing the blur avoids a visible caret jump.
 */
export function SnippetPicker({
  options,
  index,
  trigger,
  draft,
  onHover,
  onPick,
  onDismiss,
}: {
  /** Already filtered by the composer via filterSnippets. */
  options: Template[];
  index: number;
  trigger: SnippetTrigger;
  draft: string;
  onHover: (i: number) => void;
  onPick: (content: string) => void;
  onDismiss: () => void;
}) {
  const shown = options.slice(0, SNIPPET_PICKER_MAX);

  const saveDraftAsSnippet = async () => {
    const name = await promptDialog("Save snippet", { placeholder: "Snippet name" });
    if (!name?.trim()) return;
    // Save what the draft says minus the "/query" token still in it.
    const body = applySnippet(draft, trigger, "").trim();
    if (!body) {
      toast.error("Nothing to save — write the snippet text first.");
      return;
    }
    const { useStore } = await import("../lib/store");
    await useStore.getState().saveTemplate(name.trim(), body, "snippet");
    toast.success(`Saved snippet “${name.trim()}” — type / to use it.`);
    onDismiss();
  };

  return (
    <div className="menu snippet-menu" role="listbox" aria-label="Prompt library">
      {shown.length === 0 && (
        <p className="hint snip-empty">No templates match “{trigger.query}”.</p>
      )}
      {shown.map((t, i) => (
        <button
          key={t.id}
          role="option"
          aria-selected={i === index}
          className={i === index ? "active" : ""}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(t.content);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="snip-name">{t.name}</span>
          <span className={`snip-kind ${t.kind === "snippet" ? "" : "snip-kind-tpl"}`}>
            {t.kind === "snippet" ? "snippet" : "template"}
          </span>
          <span className="snip-preview">{(t.content.split("\n")[0] || "").slice(0, 60)}</span>
        </button>
      ))}
      <div className="snip-foot">
        <button
          className="link-btn"
          title="Save the draft you're typing as a reusable snippet"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void saveDraftAsSnippet()}
        >
          Save draft as snippet…
        </button>
        <button
          className="icon-btn"
          aria-label="Close picker"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onDismiss}
        >
          <IconX size={12} />
        </button>
      </div>
    </div>
  );
}
