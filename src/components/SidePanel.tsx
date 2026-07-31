import { useEffect } from "react";
import { useSidePanel, readPanelFile } from "../lib/sidePanel";
import { useStore } from "../lib/store";
import { Markdown } from "./Markdown";

/**
 * Auxiliary surface the agent can drive: a live file view, a diff, or markdown
 * (mermaid fences render as diagrams). A file shown here is re-read on a timer so
 * it updates as the agent edits it.
 */
export function SidePanel() {
  const { open, title, mode, content, file, close, show } = useSidePanel();
  const chat = useStore((s) => s.chats.find((c) => c.id === s.currentId));
  const cwd = chat?.workingDir ?? "";

  useEffect(() => {
    if (!open || !file) return;
    let alive = true;
    const tick = async () => {
      try {
        const next = await readPanelFile(file, cwd);
        if (alive && next !== useSidePanel.getState().content) show({ content: next });
      } catch {
        /* file may be mid-write — try again next tick */
      }
    };
    const t = setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, file, cwd, show]);

  if (!open) return null;

  return (
    <aside className="side-panel">
      <div className="side-panel-head">
        <span className="side-panel-title" title={file || title}>
          {title}
        </span>
        {file && <span className="side-panel-live">live</span>}
        <button className="icon-btn" title="Close panel" onClick={close}>
          x
        </button>
      </div>
      <div className="side-panel-body">
        {mode === "markdown" ? (
          <Markdown>{content}</Markdown>
        ) : mode === "diff" ? (
          <pre className="code-view diff-view">
            {content.split("\n").map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? "diff-add"
                    : line.startsWith("-") && !line.startsWith("---")
                      ? "diff-del"
                      : line.startsWith("@@")
                        ? "diff-hunk"
                        : undefined
                }
              >
                {line || " "}
              </div>
            ))}
          </pre>
        ) : (
          <pre className="code-view">{content}</pre>
        )}
      </div>
    </aside>
  );
}
