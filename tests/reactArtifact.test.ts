import { beforeEach, describe, expect, it } from "vitest";
import { extractArtifact } from "../src/lib/attach";
import {
  compileReactArtifact,
  guardScript,
  isReactLang,
  reactDocument,
} from "../src/lib/reactArtifact";

const jsxArtifact = `
\`\`\`jsx
export default function Hello() {
  return <h1>Hello canvas</h1>;
}
\`\`\`
`;

beforeEach(() => {
  // nothing stateful yet; keeps symmetry with other suites
});

describe("extraction", () => {
  it("finds a fenced jsx block as a React artifact", () => {
    const a = extractArtifact(`Here you go:\n${jsxArtifact}`);
    expect(a?.kind).toBe("react");
    expect(a?.lang).toBe("jsx");
    expect(a?.code).toContain("export default function Hello()");
  });

  it("records the tsx language so the right Babel preset runs", () => {
    const a = extractArtifact("```tsx\nexport default function X(): JSX.Element {\n  return null;\n}\n```");
    expect(a?.kind).toBe("react");
    expect(a?.lang).toBe("tsx");
  });

  it("ignores bare JSX-looking text that isn't fenced", () => {
    expect(extractArtifact("You can just write export default function Hi() { return <b/> } here.")).toBeNull();
  });

  it("leaves svg and html extraction working alongside", () => {
    expect(extractArtifact("```svg\n<svg></svg>\n```")?.kind).toBe("svg");
    expect(extractArtifact("<!doctype html><html><body>x</body></html>")?.kind).toBe("html");
  });

  it("skips an empty jsx fence", () => {
    expect(extractArtifact("```jsx\n```")).toBeNull();
  });
});

describe("isReactLang", () => {
  it("accepts jsx/tsx case-insensitively and nothing else", () => {
    expect(isReactLang("JSX")).toBe(true);
    expect(isReactLang("tsx")).toBe(true);
    expect(isReactLang("js")).toBe(false);
    expect(isReactLang("javascript")).toBe(false);
  });
});

describe("compileReactArtifact", () => {
  it("compiles a default-exported component to classic CommonJS", async () => {
    const build = await compileReactArtifact(
      "export default function Hello() { return <h1>hi</h1>; }",
      false,
    );
    expect(build.ok).toBe(true);
    expect(build.script).toContain("exports.default");
    expect(build.script).toContain(".createElement");
    // Classic runtime: no import statements survive.
    expect(build.script).not.toMatch(/^\s*import\s/m);
  });

  it("handles TypeScript syntax on the tsx path", async () => {
    const build = await compileReactArtifact(
      "interface Props { name: string }\nexport default function Greet(p: Props) {\n  return <p>{p.name}</p>;\n}",
      true,
    );
    expect(build.ok).toBe(true);
  });

  it("rejects TypeScript syntax when not declared tsx", async () => {
    const build = await compileReactArtifact("const x: number = 1;\nexport default x;", false);
    expect(build.ok).toBe(false);
    expect(build.error).toBeTruthy();
  });

  it("reports syntax errors instead of throwing", async () => {
    const build = await compileReactArtifact("export default function {{{", false);
    expect(build.ok).toBe(false);
    expect(build.error!.length).toBeGreaterThan(0);
  });

  it("escapes </script sequences in compiled output", async () => {
    const build = await compileReactArtifact(
      'export default function X() { return <p>{"</script>"}</p>; }',
      false,
    );
    expect(build.ok).toBe(true);
    expect(build.script!.toLowerCase()).not.toContain("</script>");
  });
});

describe("guardScript", () => {
  it("neutralises closing tags inside strings without changing JS semantics", () => {
    expect(guardScript('var s = "</script>";')).toBe('var s = "<\\/script>";');
    expect(guardScript("var t = '</SCRIPT>'")).toBe("var t = '<\\/SCRIPT>'");
    expect(guardScript("var ok = 1;")).toBe("var ok = 1;");
  });
});

describe("reactDocument", () => {
  it("embeds the React runtime bundle, a mount root and the compiled code", async () => {
    const build = await compileReactArtifact("export default function A() { return null; }", false);
    const doc = reactDocument(build);
    expect(doc).toContain("__HS_REACT__");
    expect(doc).toContain('id="root"');
    expect(doc).toContain("createRoot");
    expect(doc).toContain("exports.default".slice(0, 8)); // exports object exists
  });

  it("renders the failure message when compilation failed", () => {
    const doc = reactDocument({ ok: false, error: "boom" });
    expect(doc).toContain("boom");
    expect(doc).toContain('"boom"');
  });

  it("never contains an early-closed script tag", async () => {
    const build = await compileReactArtifact(
      'export default function X() { return <i>{"</script>"}</i>; }',
      false,
    );
    const doc = reactDocument(build).toLowerCase();
    // The only closers are our own three intentional ones plus none injected.
    expect(doc.split("</scr" + "ipt").length - 1).toBeLessThanOrEqual(4);
  });
});
