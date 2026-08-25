import reactBundle from "../vendor/react-runtime.iife.js?raw";

/**
 * JSX/TSX artifacts in the canvas (roadmap §2.2).
 *
 * The model writes a React component; the sandbox renders it. Two constraints
 * shaped this:
 *
 * 1. Offline and local-first — no CDN, no esm.sh. React comes from the app's
 *    own dependency versions, bundled once by scripts/build-react-runtime.mjs
 *    into an IIFE that defines `__HS_REACT__` inside the iframe.
 * 2. The iframe is where untrusted code runs, so Babel transforms *outside*
 *    it (here, in the app) and only the compiled classic script crosses the
 *    boundary. This module itself is dynamically imported, so @babel/standalone
 *    (~2.7 MB) never reaches the entry chunk — it loads when the first React
 *    artifact is previewed and is cached after that.
 *
 * Component convention: a default export wins, then named exports Component /
 * App / Demo, then a top-level `Component`/`App`. Code that renders its own
 * root via createRoot also works untouched.
 */

/** Fences we treat as React artifacts. */
export const REACT_LANGS = ["jsx", "tsx"] as const;

export interface ReactBuild {
  ok: boolean;
  /** Compiled classic script, ready to inline into the sandbox document. */
  script?: string;
  /** Human-readable transform failure (syntax error, etc.). */
  error?: string;
}

/** True when the fence language is one of ours. */
export function isReactLang(lang: string): boolean {
  return (REACT_LANGS as readonly string[]).includes(lang.toLowerCase());
}

/** Transform user JSX/TSX to a classic script that runs against window.React. */
export async function compileReactArtifact(code: string, tsx: boolean): Promise<ReactBuild> {
  let Babel: typeof import("@babel/standalone");
  try {
    Babel = await import("@babel/standalone");
  } catch (e) {
    return { ok: false, error: `Could not load the JSX compiler: ${(e as Error).message}` };
  }
  try {
    const out = Babel.transform(code, {
      filename: tsx ? "artifact.tsx" : "artifact.jsx",
      sourceType: "module",
      // CommonJS output so imports become require() calls our shim answers,
      // and exports.default becomes something the mount harness can find.
      plugins: [Babel.availablePlugins["transform-modules-commonjs"] as string],
      presets: [["react", { runtime: "classic" }], ...(tsx ? ["typescript"] : [])],
      compact: false,
    }).code;
    if (!out?.trim()) return { ok: false, error: "The component compiled to nothing." };
    return { ok: true, script: guardScript(out) };
  } catch (e) {
    return { ok: false, error: stripStack((e as Error).message || String(e)) };
  }
}

/**
 * A literal `</script>` anywhere in inlined code would close the tag early and
 * execute the rest as HTML — including from model output crafted to do exactly
 * that. Escaping the slash inside JS strings/comments neutralises it without
 * changing what the code evaluates to.
 */
export function guardScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

function stripStack(message: string): string {
  // Babel syntax errors carry the whole code frame plus stack; the first line
  // pair is the part a human can act on.
  const lines = message.split("\n").filter(Boolean);
  return lines.slice(0, 4).join("\n").slice(0, 800);
}

const CANVAS_STYLE =
  "body{margin:0;font-family:system-ui,sans-serif;color:#111;background:#fff;padding:12px}" +
  "#hs-error{display:none;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;margin-bottom:10px}";

/** The mount harness: require shim, export discovery, auto-render, error surface. */
function harnessScript(compiled: string): string {
  return `
(function () {
  "use strict";
  var errBox = document.getElementById("hs-error");
  function fail(msg) {
    errBox.textContent = String(msg);
    errBox.style.display = "block";
  }
  window.addEventListener("error", function (e) { fail(e.message); });
  window.addEventListener("unhandledrejection", function (e) { fail(e.reason && e.reason.message || e.reason); });

  var React = __HS_REACT__.React;
  var ReactDOMClient = __HS_REACT__.ReactDOMClient;
  window.React = React;
  window.ReactDOM = ReactDOMClient;
  window.require = function (name) {
    if (name === "react") return React;
    if (name === "react-dom" || name === "react-dom/client") return ReactDOMClient;
    throw new Error("Canvas artifacts can import only 'react' or 'react-dom' — got '" + name + "'");
  };

  var module = { exports: {} };
  var exports = module.exports;
  ${compiled}
  ;//# sourceURL=hs-artifact.js

  var C =
    module.exports.default ||
    module.exports.Component ||
    module.exports.App ||
    module.exports.Demo ||
    window.Component ||
    window.App ||
    null;
  if (!C) {
    fail("No component found. Default-export one, or name it Component / App / Demo.");
    return;
  }
  var root = ReactDOMClient.createRoot(document.getElementById("root"));
  root.render(React.createElement(C));
})();
`;
}

/** Build the full srcdoc for a compiled React artifact. */
export function reactDocument(build: ReactBuild): string {
  const head =
    `<!doctype html><html><head><meta charset="utf-8"><style>${CANVAS_STYLE}</style>` +
    `<script>${guardScript(reactBundle)}</scr` +
    `ipt></head>`;
  const body = `<div id="hs-error"></div><div id="root"></div>`;
  if (!build.ok) {
    return (
      `${head}<body>${body}<script>document.getElementById("hs-error").style.display="block";` +
      `document.getElementById("hs-error").textContent=${JSON.stringify(build.error ?? "Unknown error")};</scr` +
      `ipt></body></html>`
    );
  }
  return `${head}<body>${body}<script>${harnessScript(build.script ?? "")}</scr` + `ipt></body></html>`;
}
