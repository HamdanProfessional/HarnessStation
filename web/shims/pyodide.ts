/**
 * Python execution for the web build, via Pyodide.
 *
 * The desktop app shells out to the system Python. In the browser that becomes
 * Pyodide — CPython compiled to WebAssembly, running in the tab. It's loaded
 * from the official CDN on first use (so it adds nothing to the app bundle and
 * costs only users who actually run a Python tool), and after that everything
 * executes locally: no server, no system Python required.
 *
 * The contract matches the desktop's python_run exactly — run the tool's code,
 * call the named function with the JSON args, return json.dumps of the result —
 * so the tool layer is unchanged.
 */

import { registerCommand } from "./core";

const PYODIDE_VERSION = "0.26.4";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`;

interface Pyodide {
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched: (s: string) => void }) => void;
  setStderr: (opts: { batched: (s: string) => void }) => void;
  globals: { set: (k: string, v: unknown) => void; get: (k: string) => unknown };
}

let py: Pyodide | null = null;
let loading: Promise<Pyodide> | null = null;

async function getPyodide(): Promise<Pyodide> {
  if (py) return py;
  if (loading) return loading;
  loading = (async () => {
    // Native ESM import of the CDN module — deliberately not bundled, and
    // @vite-ignore so the build doesn't try to resolve a URL at compile time.
    const mod = await import(/* @vite-ignore */ `${CDN}/pyodide.mjs`);
    const instance = (await mod.loadPyodide({ indexURL: `${CDN}/` })) as Pyodide;
    py = instance;
    return instance;
  })();
  loading.catch(() => {
    loading = null; // a failed load must not wedge every later attempt
  });
  return loading;
}

/**
 * Run a Python tool. `code` defines the functions, `func` is the one to call,
 * `args` is a JSON object of its arguments. Returns json.dumps of the result,
 * matching the desktop.
 */
async function pythonRun(code: string, func: string, argsJson: string): Promise<string> {
  const p = await getPyodide();
  const out: string[] = [];
  p.setStdout({ batched: (s) => out.push(s) });
  p.setStderr({ batched: (s) => out.push(s) });

  p.globals.set("__hs_code", code);
  p.globals.set("__hs_func", func);
  p.globals.set("__hs_args", argsJson);

  // The user code runs in its own namespace so its names can't collide with the
  // harness. Errors come back as a JSON {error} rather than throwing, matching
  // how the tool layer reports failures.
  const harness = `
import json as _json, traceback as _tb
_ns = {}
try:
    exec(__hs_code, _ns)
    _fn = _ns.get(__hs_func)
    if _fn is None:
        _out = _json.dumps({"error": "function '%s' not found in the code" % __hs_func})
    else:
        _res = _fn(**_json.loads(__hs_args))
        _out = _json.dumps(_res, default=str)
except Exception:
    _out = _json.dumps({"error": _tb.format_exc()})
_out
`;
  const result = (await p.runPythonAsync(harness)) as string;
  return result;
}

/**
 * Derive an Agents-SDK-style schema from a function's signature and docstring —
 * the desktop's python_schema, reimplemented in Pyodide so the tool editor works
 * in the browser too.
 */
async function pythonSchema(code: string): Promise<string> {
  const p = await getPyodide();
  p.globals.set("__hs_code", code);
  const script = `
import json as _json, inspect as _ins
_ns = {}
try:
    exec(__hs_code, _ns)
    _fns = [(_n, _f) for _n, _f in _ns.items() if callable(_f) and not _n.startswith("_")]
    if not _fns:
        _out = _json.dumps({"error": "no top-level function found in the code"})
    else:
        _name, _fn = _fns[0]
        _sig = _ins.signature(_fn)
        _props, _req = {}, []
        for _pn, _pv in _sig.parameters.items():
            _t = "string"
            _ann = _pv.annotation
            if _ann in (int,): _t = "integer"
            elif _ann in (float,): _t = "number"
            elif _ann in (bool,): _t = "boolean"
            _props[_pn] = {"type": _t}
            if _pv.default is _ins.Parameter.empty: _req.append(_pn)
        _out = _json.dumps({
            "name": _name,
            "description": (_ins.getdoc(_fn) or "").strip(),
            "parameters": {"type": "object", "properties": _props, "required": _req},
        })
except Exception as _e:
    _out = _json.dumps({"error": str(_e)})
_out
`;
  return (await p.runPythonAsync(script)) as string;
}

registerCommand("python_run", (args) => {
  const { code, func, args: a } = (args ?? {}) as { code: string; func: string; args: string };
  return pythonRun(code, func, a);
});

registerCommand("python_schema", (args) => {
  const { code } = (args ?? {}) as { code: string };
  return pythonSchema(code);
});
