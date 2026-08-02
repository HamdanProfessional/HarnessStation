import { useEffect, useRef, useState } from "react";
import { search, type Hit } from "../search";
import { navigate } from "../router";

/** Render the \x00-delimited match from search.ts as a highlight. */
function Excerpt({ text }: { text: string }) {
  const parts = text.split("\x00");
  return (
    <span className="hit-excerpt">
      {parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}
    </span>
  );
}

export function Search() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits: Hit[] = open ? search(query) : [];

  // Ctrl+K, the shortcut every docs site has and readers try first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // Keep the highlighted row in range as results change under the cursor.
  useEffect(() => setActive(0), [query]);

  const go = (hit: Hit) => {
    navigate(hit.slug, hit.hash ?? "");
    setOpen(false);
    if (hit.hash) {
      requestAnimationFrame(() =>
        document.getElementById(hit.hash!.slice(1))?.scrollIntoView({ behavior: "smooth" }),
      );
    }
  };

  if (!open) {
    return (
      <button className="search-trigger" onClick={() => setOpen(true)}>
        <span>Search</span>
        <kbd>Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div className="search-overlay" onClick={() => setOpen(false)}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="search-input"
          value={query}
          placeholder="Search the documentation…"
          aria-label="Search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && hits[active]) {
              go(hits[active]);
            }
          }}
        />
        <div className="search-results">
          {query.trim().length >= 2 && hits.length === 0 && (
            <p className="search-empty">No page mentions “{query}”.</p>
          )}
          {hits.map((hit, i) => (
            <button
              key={`${hit.slug}${hit.hash ?? ""}`}
              className={`hit ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
            >
              <span className="hit-title">
                {hit.title}
                {hit.section && <span className="hit-section"> › {hit.section}</span>}
              </span>
              {hit.excerpt && <Excerpt text={hit.excerpt} />}
            </button>
          ))}
        </div>
        <div className="search-foot">
          <kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
