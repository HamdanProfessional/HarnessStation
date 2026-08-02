# Documentation site

The public docs for HarnessStation. Markdown is the source of truth; this is a
renderer for it.

```bash
npm run docs:dev       # http://localhost:5174
npm run docs:build     # → docs-site/dist
npm run docs:preview   # serve the build
```

## Adding a page

1. Write the markdown under `content/`, with front matter:

   ```markdown
   ---
   title: Short page title
   description: One sentence, shown under the title and in search results.
   ---

   # Short page title
   ```

2. Add its slug to the right section of `src/nav.ts`.

The slug is the path under `content/` without the extension — `content/guide/tools.md`
is `guide/tools`. Relative links between pages use the same paths
(`../voice/engines`), so they work in the rendered site *and* when reading the
markdown on GitHub.

`npm test` fails if a page is missing from the nav, the nav points at a page that
doesn't exist, a page has no title or description, or an internal link is broken.

## Callouts

Blockquotes beginning `**Note:**`, `**Tip:**` or `**Warning:**` render as
coloured callouts. Markdown has no callout syntax, and inventing one would stop
the source reading as plain markdown everywhere else.

## Deploying

The build is static — any host will serve it.

Clean URLs mean the host must serve the app shell for unknown paths. A `404.html`
is emitted for GitHub Pages, which is also what Netlify and Cloudflare Pages
honour; on other hosts, add a rewrite to `index.html`.

To deploy under a sub-path rather than a domain root:

```bash
DOCS_BASE=/docs/ npm run docs:build
```

The base must stay absolute. A relative one (`./`) appears to work at the root
and then breaks every deep link: from `/guide/tools` the browser resolves
`./assets/…` against `/guide/`, gets `index.html` back from the SPA fallback with
a `text/html` type, and renders a blank page — with a 200 in the network tab.
