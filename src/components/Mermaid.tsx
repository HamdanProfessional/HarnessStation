import { useEffect, useRef, useState } from "react";

let idSeq = 0;

export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.dataset.theme !== "light";
        mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict" });
        const { svg } = await mermaid.render(`mmd-${idSeq++}`, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message || "diagram error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="mermaid-wrap">
      {error ? <pre className="code-view">{error}</pre> : <div ref={ref} className="mermaid-render" />}
    </div>
  );
}
