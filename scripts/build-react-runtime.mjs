/**
 * Builds the in-canvas React runtime for JSX/TSX artifacts (roadmap §2.2).
 *
 * The canvas renders untrusted model output inside a sandboxed iframe, so the
 * React the artifact uses must live entirely inside that iframe's document —
 * it cannot share the app's module graph. There are no UMD builds to inline
 * since React 19, so we bundle our own IIFE from the app's own react and
 * react-dom versions. The output is committed under src/vendor/ and imported
 * as `?raw`, which keeps it out of every chunk until a React artifact is
 * actually previewed.
 *
 * Regenerate after a react/react-dom upgrade:
 *
 *     node scripts/build-react-runtime.mjs
 */
import esbuild from "esbuild";

const entry = `
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
export { React, ReactDOMClient };
`;

await esbuild.build({
  stdin: {
    contents: entry,
    resolveDir: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    sourcefile: "react-runtime-entry.js",
  },
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "__HS_REACT__",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "src/vendor/react-runtime.iife.js",
  logLevel: "info",
});
