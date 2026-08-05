import { useEffect, useState } from "react";
import { getDoc, type Heading } from "./content";
import { NAV, neighbours } from "./nav";
import { href, useRoute } from "./router";
import { DocMarkdown } from "./components/DocMarkdown";
import { Search } from "./components/Search";

/** Which heading the reader is currently level with, for the contents list. */
function useActiveHeading(headings: Heading[]): string {
  const [active, setActive] = useState("");

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // The topmost heading currently on screen wins. Taking the last
        // intersecting one instead makes the highlight jump ahead of the reader.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Only count headings in the upper part of the viewport, which is where a
      // reader's attention actually is.
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  return active;
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme !== "light");
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("hs-docs-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button
      className="icon-btn theme-toggle"
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {dark ? "☀" : "☾"}
    </button>
  );
}

export function App() {
  const slug = useRoute();
  const doc = getDoc(slug);
  const [menuOpen, setMenuOpen] = useState(false);
  const active = useActiveHeading(doc?.headings ?? []);
  const { prev, next } = neighbours(slug);

  useEffect(() => {
    document.title = doc ? `${doc.title} — HarnessStation docs` : "HarnessStation docs";
  }, [doc]);

  // The sidebar is a drawer on a phone; a tap through to a page should close it.
  useEffect(() => setMenuOpen(false), [slug]);

  // Deep links land before the page has rendered, so the anchor is scrolled to
  // once the content exists rather than on load.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && doc) {
      requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
    }
  }, [doc]);

  return (
    <div className="docs">
      <div className="site-bg" aria-hidden="true">
        <div className="aurora" />
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="beam n1" />
        <div className="beam n2" />
        <div className="grid" />
        <div className="noise" />
      </div>
      <header className="docs-header">
        <button
          className="icon-btn menu-btn"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <a className="brand" href={href("index")}>
          <span className="brand-mark" aria-hidden="true" />
          HarnessStation
          <span className="brand-sub">docs</span>
        </a>
        <div className="grow" />
        <Search />
        <ThemeToggle />
      </header>

      <div className="docs-shell">
        <nav className={`docs-nav ${menuOpen ? "open" : ""}`} aria-label="Documentation">
          {NAV.map((section) => (
            <div key={section.title} className="nav-group">
              <h2 className="nav-group-title">{section.title}</h2>
              {section.items.map((item) => (
                <a
                  key={item.slug}
                  className={`nav-link ${item.slug === slug ? "active" : ""}`}
                  aria-current={item.slug === slug ? "page" : undefined}
                  href={href(item.slug)}
                >
                  {item.label ?? getDoc(item.slug)?.title ?? item.slug}
                </a>
              ))}
            </div>
          ))}
        </nav>

        <main className="docs-content">
          {doc ? (
            <article>
              {doc.description && <p className="doc-lede">{doc.description}</p>}
              <DocMarkdown>{doc.body}</DocMarkdown>

              <nav className="doc-pager" aria-label="Nearby pages">
                {prev ? (
                  <a className="pager-link prev" href={href(prev.slug)}>
                    <span className="pager-dir">Previous</span>
                    <span className="pager-title">{prev.label ?? getDoc(prev.slug)?.title}</span>
                  </a>
                ) : (
                  <span />
                )}
                {next && (
                  <a className="pager-link next" href={href(next.slug)}>
                    <span className="pager-dir">Next</span>
                    <span className="pager-title">{next.label ?? getDoc(next.slug)?.title}</span>
                  </a>
                )}
              </nav>
            </article>
          ) : (
            <article className="not-found">
              <h1>Page not found</h1>
              <p>
                There's nothing at <code>{slug}</code>. It may have been renamed — try the search, or
                start from <a href={href("index")}>the beginning</a>.
              </p>
            </article>
          )}
        </main>

        {doc && doc.headings.length > 2 && (
          <aside className="docs-toc" aria-label="On this page">
            <h2 className="toc-title">On this page</h2>
            {doc.headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className={`toc-link depth-${h.depth} ${active === h.id ? "active" : ""}`}
                onClick={(e) => {
                  // Smooth-scroll without pushing a history entry per heading.
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth" });
                  window.history.replaceState({}, "", `#${h.id}`);
                }}
              >
                {h.text}
              </a>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
