import { useEffect, useMemo, useState } from "react";
import type { Artifact } from "../lib/attach";

const BASE_STYLE =
  "body{margin:0;font-family:system-ui,sans-serif;color:#111;background:#fff;padding:12px}";

/** Wrap an HTML fragment into a full document if it isn't one already. */
function toDocument(html: string): string {
  if (/<!doctype html/i.test(html) || /<html[\s>]/i.test(html)) return html;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head><body>${html}</body></html>`;
}

/** Centre an SVG on a neutral backdrop and let it scale to the frame. */
function svgDocument(svg: string): string {
  const style = `${BASE_STYLE}
body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;box-sizing:border-box}
svg{max-width:100%;max-height:calc(100vh - 32px);height:auto}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>${svg}</body></html>`;
}

const LABEL: Record<Artifact["kind"], string> = {
  html: "HTML canvas — runnable",
  svg: "SVG drawing",
  react: "React component — runnable",
};

export function Canvas({ artifact }: { artifact: Artifact }) {
  const { kind, code } = artifact;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [reloadKey, setReloadKey] = useState(0);
  // React artifacts compile off the render path (Babel is a lazy ~2.7 MB
  // import) and their document arrives async; the others build synchronously.
  const [reactDoc, setReactDoc] = useState<string | null>(null);
  const doc = useMemo(
    () => (kind === "svg" ? svgDocument(code) : kind === "html" ? toDocument(code) : null),
    [kind, code],
  );

  useEffect(() => {
    if (kind !== "react") return;
    let cancelled = false;
    setReactDoc(null);
    void (async () => {
      // Dynamic import: reactArtifact inlines the 189 kB runtime bundle as a
      // string, so it must never ride along with the entry chunk — it loads
      // (once) only when a React artifact is actually previewed.
      const m = await import("../lib/reactArtifact");
      const build = await m.compileReactArtifact(code, artifact.lang === "tsx");
      if (!cancelled) setReactDoc(m.reactDocument(build));
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, code, artifact.lang, reloadKey]);

  const srcDoc = kind === "react" ? reactDoc : doc;

  return (
    <div className="canvas">
      <button className="canvas-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="canvas-dot" />
        <span className="grow">{LABEL[kind]}</span>
        <span className="toolcall-toggle">{open ? "hide" : kind === "svg" ? "show" : "run"}</span>
      </button>
      {open && (
        <div className="canvas-body">
          <div className="canvas-tabs">
            <button className={`seg-btn ${tab === "preview" ? "active" : ""}`} onClick={() => setTab("preview")}>
              Preview
            </button>
            <button className={`seg-btn ${tab === "code" ? "active" : ""}`} onClick={() => setTab("code")}>
              Code
            </button>
            <div className="grow" />
            <button
              className="btn small"
              title="Reload the canvas"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Refresh
            </button>
          </div>
          {tab === "preview" ? (
            srcDoc ? (
              <iframe
                key={reloadKey}
                className="canvas-frame"
                title={kind === "svg" ? "SVG preview" : "canvas"}
                // SVG is static content, so it needs no script privileges at all.
                sandbox={kind === "svg" ? "" : "allow-scripts allow-modals allow-forms allow-popups"}
                srcDoc={srcDoc}
              />
            ) : (
              <div className="hint canvas-loading">Compiling…</div>
            )
          ) : (
            <pre className="code-view" style={{ maxHeight: 340 }}>
              {code}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
