import { useState } from "react";
import { CodeEditor } from "./CodeEditor";
import { confirmDialog, promptDialog } from "../lib/dialog";
import { prettyName } from "../lib/format";
import { useStore } from "../lib/store";
import { detectPythonSchema, executeTool } from "../lib/tools";
import type { Tool } from "../lib/types";

const EMPTY_JS: Tool = {
  id: "",
  name: "my_tool",
  description: "",
  parameters: { type: "object", properties: {}, required: [] },
  code: `// args: object matching the parameters schema
// ctx.fetch: HTTP fetch (CORS-free); ctx.fs: file helpers
return "hello from my_tool";`,
  runtime: "js",
};

const EMPTY_PY: Tool = {
  id: "",
  name: "my_tool",
  description: "",
  parameters: { type: "object", properties: {}, required: [] },
  code: `def my_tool(city: str, days: int = 3) -> str:
    """One-line docstring becomes the tool description for the model."""
    return f"Weather for {city} over {days} days: sunny"
`,
  runtime: "python",
};

export function ToolsView() {
  const { allTools, customTools, saveTool, deleteTool } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [paramsText, setParamsText] = useState("");
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const [detecting, setDetecting] = useState(false);

  const startEdit = (t: Tool) => {
    setEditing({ ...structuredClone(t), runtime: t.runtime ?? "js" });
    setParamsText(JSON.stringify(t.parameters, null, 2));
    setError(null);
    setTestResult(null);
  };

  const detectPy = async () => {
    if (!editing) return;
    setError(null);
    setDetecting(true);
    try {
      const schema = await detectPythonSchema(editing.code);
      setEditing({ ...editing, name: schema.name, description: schema.description });
      setParamsText(JSON.stringify(schema.parameters, null, 2));
    } catch (e) {
      setError((e as Error).message || String(e));
    } finally {
      setDetecting(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setError(null);
    if (!/^[\w-]+$/.test(editing.name)) {
      setError("Tool name must be letters, digits, _ or - (it becomes the function name).");
      return;
    }
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(paramsText);
    } catch {
      setError("Parameters is not valid JSON.");
      return;
    }
    const tool: Tool = {
      ...editing,
      id: editing.id || `tool-${Date.now()}`,
      parameters: params,
      runtime: editing.runtime ?? "js",
      builtin: false,
    };
    await saveTool(tool);
    setEditing(null);
  };

  const test = async () => {
    if (!editing) return;
    setTestResult(null);
    setError(null);
    try {
      const args = await promptDialog("Test run", {
        message: "Test args as a JSON object",
        defaultValue: "{}",
        placeholder: '{"expression":"2+2"}',
      });
      if (args === null) return;
      const result = await executeTool(
        { ...editing, parameters: JSON.parse(paramsText || "{}") },
        JSON.parse(args || "{}"),
      );
      setTestResult(result || "(empty result)");
    } catch (e) {
      setError((e as Error).message || String(e));
    }
  };

  const importTool = async () => {
    setError(null);
    try {
      const t = JSON.parse(importText) as Tool;
      if (!t.name || !t.code) throw new Error("JSON must have at least name and code fields.");
      // Same review gate as community imports: pasted JSON is untrusted, and a
      // tool is arbitrary code that runs with this app's permissions the moment
      // a chat enables it.
      const ok = await confirmDialog(`Import tool "${t.name}"?`, {
        message: `A custom tool is arbitrary ${t.runtime === "python" ? "Python" : "JavaScript"} that runs with this app's permissions once a chat enables it. Read the code before trusting it.`,
        danger: true,
        confirmLabel: "Import",
      });
      if (!ok) return;
      await saveTool({
        id: t.id || `tool-${Date.now()}`,
        name: t.name,
        description: t.description ?? "",
        parameters: t.parameters ?? { type: "object", properties: {}, required: [] },
        code: t.code,
        runtime: t.runtime === "python" ? "python" : "js",
        builtin: false,
      });
      setImportText("");
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <main className="settings-main">
      <div className="settings-header">
        <h1>Tools</h1>
        <div>
          <button className="btn" onClick={() => startEdit(EMPTY_JS)}>
            New JS tool
          </button>{" "}
          <button className="btn primary" onClick={() => startEdit(EMPTY_PY)}>
            New Python tool
          </button>
        </div>
      </div>
      <p className="hint">
        Tools are functions the model can call in chat (enable them per-chat in the right panel)
        and workflows can invoke directly. Write them in JavaScript, or in Python like the OpenAI
        Agents SDK — a typed function with a docstring; its schema is read automatically. Custom
        tools are stored as JSON files in ~\.harnessx\tools.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {editing ? (
        <section className="provider-card">
          {(() => {
            const isPy = editing.runtime === "python";
            return (
              <>
                <div className="provider-row">
                  <span className="wf-badge">{isPy ? "Python" : "JavaScript"}</span>
                  <input
                    className="provider-name"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="tool_name"
                    readOnly={isPy}
                  />
                  <input
                    className="grow"
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="What does this tool do? (shown to the model)"
                  />
                </div>
                <label className="field">
                  <span>
                    Code —{" "}
                    {isPy
                      ? "a top-level def with type hints + docstring (OpenAI Agents SDK style)"
                      : "async function body receiving (args, ctx)"}
                  </span>
                  <CodeEditor
                    value={editing.code}
                    language={isPy ? "python" : "javascript"}
                    minRows={isPy ? 12 : 10}
                    onChange={(v) => setEditing({ ...editing, code: v })}
                  />
                </label>
                <label className="field">
                  <span>
                    Parameters (JSON schema)
                    {isPy && " — auto-detected from the function signature"}
                  </span>
                  <CodeEditor
                    value={paramsText}
                    language="json"
                    minRows={6}
                    readOnly={isPy}
                    onChange={setParamsText}
                  />
                </label>
                <div className="provider-row">
                  <button className="btn primary" onClick={() => void save()}>
                    Save tool
                  </button>
                  {isPy && (
                    <button className="btn" disabled={detecting} onClick={() => void detectPy()}>
                      {detecting ? "Reading..." : "Detect schema"}
                    </button>
                  )}
                  <button className="btn" onClick={() => void test()}>
                    Test run
                  </button>
                  <button className="btn" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
                {isPy && (
                  <p className="hint">
                    Requires Python 3 on PATH. Return a value the model can read (str/number/dict).
                    Runs with a 60s timeout.
                  </p>
                )}
              </>
            );
          })()}
          {testResult && (
            <pre className="code-view">{testResult}</pre>
          )}
        </section>
      ) : (
        <>
          <section>
            <div className="card-grid">
              {allTools().map((t) => {
                const kind = t.id.startsWith("mcp:")
                  ? "MCP"
                  : t.runtime === "python"
                    ? "Python"
                    : t.builtin
                      ? "System"
                      : "JS";
                return (
                  <div key={t.id} className="tool-card">
                    <div className="tool-card-head">
                      <div className="grow">
                        <div className="tool-card-name">{prettyName(t.name)}</div>
                        <code className="tool-card-id">{t.name}</code>
                      </div>
                      <span className={`tool-tag tag-${kind === "MCP" ? "MCP" : kind === "Python" ? "PY" : kind === "JS" ? "JS" : ""}`}>
                        {kind}
                      </span>
                    </div>
                    <div className="tool-card-desc">{t.description || "No description."}</div>
                    <div className="tool-card-foot">
                      <button
                        className="link-btn"
                        onClick={() => setOpenId(openId === t.id ? null : t.id)}
                      >
                        {openId === t.id ? "Hide code" : "View code"}
                      </button>
                      {t.builtin ? (
                        <button
                          className="link-btn"
                          onClick={() => startEdit({ ...t, id: "", name: `${t.name}_copy`, builtin: false })}
                        >
                          Copy as new
                        </button>
                      ) : (
                        <>
                          <button className="link-btn" onClick={() => startEdit(t)}>
                            Edit
                          </button>
                          <button
                            className="link-btn danger-link"
                            onClick={async () => {
                              if (await confirmDialog(`Delete ${prettyName(t.name)}?`, { danger: true }))
                                void deleteTool(t.id);
                            }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                    {openId === t.id && (
                      <pre className="code-view">
                        {`// parameters:\n${JSON.stringify(t.parameters, null, 2)}\n\n// code:\n${t.code}`}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2>Import tool from JSON</h2>
            <textarea
              rows={5}
              className="code"
              placeholder='{"name":"my_tool","description":"...","parameters":{...},"code":"return ..."}'
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button className="btn" onClick={() => void importTool()} disabled={!importText.trim()}>
              Import
            </button>
            {customTools.length > 0 && (
              <p className="hint">
                To export a tool, its JSON file already lives in ~\.harnessx\tools.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
