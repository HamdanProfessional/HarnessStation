import { useEffect, useState } from "react";

/**
 * A very small router.
 *
 * The site is a few dozen static pages with no data loading, no nested layouts
 * and no route params — everything a routing library exists to manage. This is
 * the whole of what's needed: read the path, listen for changes, push new ones.
 *
 * Paths are relative to `BASE`, so the site works at a domain root or under a
 * sub-path like `/docs/` without the links being rewritten.
 */

/** Where the site is mounted, e.g. "/" or "/docs/". Derived from the build base. */
const BASE = (() => {
  const base = import.meta.env.BASE_URL || "/";
  // A relative base ("./") tells us nothing about the mount point; the document
  // URL does. Everything up to the last slash is the directory we're served from.
  if (base === "./" || base === "") {
    return window.location.pathname.replace(/[^/]*$/, "");
  }
  return base.endsWith("/") ? base : `${base}/`;
})();

function currentSlug(): string {
  let path = window.location.pathname;
  if (path.startsWith(BASE)) path = path.slice(BASE.length);
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.html$/, "");
  return path || "index";
}

export function href(slug: string): string {
  return `${BASE}${slug === "index" ? "" : slug}`;
}

export function navigate(slug: string, hash = ""): void {
  window.history.pushState({}, "", href(slug) + hash);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): string {
  const [slug, setSlug] = useState(currentSlug);

  useEffect(() => {
    const onPop = () => setSlug(currentSlug());
    window.addEventListener("popstate", onPop);

    // Intercept in-site links so the whole document isn't reloaded. Doing it
    // here rather than with a <Link> component means links written in plain
    // markdown behave the same as ones in the shell.
    const onClick = (e: MouseEvent) => {
      // Leave modified clicks alone — they mean "new tab", "download", "save".
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const link = (e.target as HTMLElement).closest("a");
      if (!link) return;
      const url = link.getAttribute("href");
      if (!url || link.target === "_blank" || /^(https?:|mailto:|tel:)/.test(url)) return;

      // A bare fragment is an on-page jump, which the browser already does well.
      if (url.startsWith("#")) return;

      e.preventDefault();
      const [path, hash] = url.split("#");
      const target = new URL(path, window.location.origin + window.location.pathname).pathname;
      window.history.pushState({}, "", target + (hash ? `#${hash}` : ""));
      setSlug(currentSlug());
      if (hash) {
        // The heading only exists once the new page has rendered.
        requestAnimationFrame(() =>
          document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" }),
        );
      } else {
        window.scrollTo({ top: 0 });
      }
    };

    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return slug;
}
