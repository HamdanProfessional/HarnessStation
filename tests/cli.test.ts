import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM, no types; the CLI ships as .mjs so it runs from
// the installed app without a build step.
import * as cli from "../cli/lib.mjs";

describe("argument parsing", () => {
  it("takes a command and its positionals", () => {
    const r = cli.parseArgs(["chat", "hello", "world"]);
    expect(r.cmd).toBe("chat");
    expect(r.args).toEqual(["hello", "world"]);
  });

  it("reads --flag value and --flag=value the same way", () => {
    expect(cli.parseArgs(["chat", "--model", "opus"]).flags.model).toBe("opus");
    expect(cli.parseArgs(["chat", "--model=opus"]).flags.model).toBe("opus");
  });

  it("expands the short forms", () => {
    const r = cli.parseArgs(["chat", "-m", "opus", "-a", "Critic"]);
    expect(r.flags.model).toBe("opus");
    expect(r.flags.agent).toBe("Critic");
  });

  it("treats a flag followed by another flag as boolean", () => {
    // `--json --model x` must not swallow "--model" as the value of --json.
    const r = cli.parseArgs(["models", "--json", "--model", "x"]);
    expect(r.flags.json).toBe(true);
    expect(r.flags.model).toBe("x");
  });

  it("sends everything after -- as positional", () => {
    // Otherwise a prompt that starts with a dash is unsendable.
    const r = cli.parseArgs(["chat", "--", "--help", "me"]);
    expect(r.args).toEqual(["--help", "me"]);
    expect(r.flags.help).toBeUndefined();
  });

  it("keeps a value that looks like a negative number", () => {
    // -1 parses as a short flag if you are not careful, and gpu-layers style
    // options legitimately take it.
    const r = cli.parseArgs(["chat", "hi", "--temp=-1"]);
    expect(r.flags.temp).toBe("-1");
  });
});

describe("frontmatter", () => {
  it("reads name and description", () => {
    const fm = cli.frontmatter("---\nname: demo\ndescription: Does a thing\n---\n\nBody");
    expect(fm).toEqual({ name: "demo", description: "Does a thing" });
  });

  it("unquotes the JSON-quoted form the app writes", () => {
    const fm = cli.frontmatter('---\nname: x\ndescription: "Handles: colons"\n---\nb');
    expect(fm.description).toBe("Handles: colons");
  });

  it("survives a file with no frontmatter", () => {
    expect(cli.frontmatter("just a body")).toEqual({ name: "", description: "" });
  });

  it("handles CRLF, since these files are written on Windows", () => {
    const fm = cli.frontmatter("---\r\nname: demo\r\ndescription: Thing\r\n---\r\n\r\nBody");
    expect(fm.name).toBe("demo");
    expect(fm.description).toBe("Thing");
  });
});

describe("the API target", () => {
  it("falls back to the documented default port", () => {
    expect(cli.apiTarget(null).port).toBe(cli.DEFAULT_PORT);
  });

  it("prefers the port from settings", () => {
    expect(cli.apiTarget({ localApi: { enabled: true, port: 9999 } }).port).toBe(9999);
  });

  it("lets an explicit --port win over settings", () => {
    expect(cli.apiTarget({ localApi: { port: 9999 } }, "8123").port).toBe(8123);
  });

  it("reports enabled separately from the port", () => {
    // The server only runs when switched on, so "refused" has two causes and
    // the CLI has to tell them apart before making a request.
    expect(cli.apiTarget({ localApi: { enabled: false, port: 1 } }).enabled).toBe(false);
    expect(cli.apiTarget({ localApi: { enabled: true, port: 1 } }).enabled).toBe(true);
  });
});

describe("diagnosis", () => {
  const target = { port: 11435, enabled: true, base: "" };

  it("names the missing config first", () => {
    expect(cli.diagnose({ settings: null, target, reachable: false })).toMatch(/run the desktop app/i);
  });

  it("says the server is off rather than blaming the connection", () => {
    const msg = cli.diagnose({ settings: {}, target: { ...target, enabled: false }, reachable: false });
    expect(msg).toMatch(/switched off/i);
    expect(msg).toMatch(/Settings/);
  });

  it("names the port when nothing is listening", () => {
    expect(cli.diagnose({ settings: {}, target, reachable: false })).toContain("11435");
  });

  it("is empty when everything is in place", () => {
    expect(cli.diagnose({ settings: {}, target, reachable: true })).toBe("");
  });
});

describe("the chat body", () => {
  const agent = { name: "Critic", description: "d", model: "opus", instructions: "You are a critic." };

  it("sends the prompt as a user message", () => {
    const b = cli.chatBody({ prompt: "hi" });
    expect(b.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("puts the agent's instructions in a system message", () => {
    const b = cli.chatBody({ prompt: "hi", agent });
    expect(b.messages[0]).toEqual({ role: "system", content: "You are a critic." });
    expect(b.model).toBe("opus");
  });

  it("lets an explicit model beat the agent's", () => {
    // --model was typed for this run; the agent's is a default.
    expect(cli.chatBody({ prompt: "hi", agent, model: "haiku" }).model).toBe("haiku");
  });

  it("combines the agent prompt and --system rather than dropping one", () => {
    const b = cli.chatBody({ prompt: "hi", agent, system: "Be terse." });
    expect(b.messages[0].content).toBe("You are a critic.\n\nBe terse.");
  });

  it("omits model entirely when nothing selects one", () => {
    // Sending "" would override the app's own default with an unresolvable id.
    expect(cli.chatBody({ prompt: "hi" }).model).toBeUndefined();
  });
});

describe("finding an agent", () => {
  const agents = [{ name: "Code Reviewer", description: "", model: "", instructions: "x" }];

  it("matches regardless of case and spacing", () => {
    for (const q of ["Code Reviewer", "code reviewer", "CODEREVIEWER", " codereviewer "]) {
      expect(cli.findAgent(agents, q), q).not.toBeNull();
    }
  });

  it("returns null rather than guessing", () => {
    expect(cli.findAgent(agents, "reviewer")).toBeNull();
    expect(cli.findAgent(agents, "")).toBeNull();
  });
});

describe("reading the stream", () => {
  it("pulls the delta out of a chunk", () => {
    expect(cli.deltaText('{"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
  });

  it("returns empty for the frames that carry no text", () => {
    // Role-only openers and [DONE] arrive on every stream.
    expect(cli.deltaText("[DONE]")).toBe("");
    expect(cli.deltaText('{"choices":[{"delta":{"role":"assistant"}}]}')).toBe("");
    expect(cli.deltaText("not json")).toBe("");
    expect(cli.deltaText("")).toBe("");
  });

  it("splits complete SSE events and keeps the partial tail", () => {
    // A chunk boundary lands mid-event constantly; consuming the tail would
    // drop a token every time it happened.
    const { frames, tail } = cli.sseFrames('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
    expect(tail).toBe('data: {"c"');
  });

  it("handles CRLF line endings", () => {
    const { frames } = cli.sseFrames('data: {"a":1}\r\n\r\n');
    expect(frames).toEqual(['{"a":1}']);
  });
});

describe("reading what is on disk", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "hs-cli-"));
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({
        localApi: { enabled: true, port: 12345 },
        agents: [{ name: "Critic", description: "Reviews", model: "opus", instructions: "i" }],
      }),
    );
    mkdirSync(join(root, "skills", "deep-research"), { recursive: true });
    writeFileSync(
      join(root, "skills", "deep-research", "SKILL.md"),
      '---\nname: deep-research\ndescription: "Research: thoroughly"\n---\n\nDo it.',
    );
    // A directory with no SKILL.md must be skipped, not crash the listing.
    mkdirSync(join(root, "skills", "half-made"), { recursive: true });
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads settings and the port from them", () => {
    expect(cli.apiTarget(cli.readSettings(root)).port).toBe(12345);
  });

  it("lists agents", () => {
    const a = cli.readAgents(root);
    expect(a).toHaveLength(1);
    expect(a[0].name).toBe("Critic");
  });

  it("lists skills with their descriptions, skipping incomplete ones", () => {
    const s = cli.readSkills(root);
    expect(s).toHaveLength(1);
    expect(s[0].slug).toBe("deep-research");
    expect(s[0].description).toBe("Research: thoroughly");
  });

  it("returns empty rather than throwing when nothing is installed", () => {
    const empty = join(root, "does-not-exist");
    expect(cli.readSettings(empty)).toBeNull();
    expect(cli.readAgents(empty)).toEqual([]);
    expect(cli.readSkills(empty)).toEqual([]);
  });
});

describe("an explicitly named port", () => {
  it("bypasses the app's own enabled toggle", () => {
    // Naming a port says where to go. The app's switch governs the app's
    // server, not some other compatible one — gating on it refuses a target
    // the user just pointed at.
    const settings = { localApi: { enabled: false, port: 11435 } };
    const target = cli.apiTarget(settings, "18435");
    expect(target.explicit).toBe(true);
    expect(cli.diagnose({ settings, target, reachable: true })).toBe("");
  });

  it("still reports an unreachable explicit port", () => {
    const target = cli.apiTarget({}, "18435");
    expect(cli.diagnose({ settings: {}, target, reachable: false })).toContain("18435");
  });

  it("keeps honouring the toggle when no port was given", () => {
    const settings = { localApi: { enabled: false, port: 11435 } };
    const target = cli.apiTarget(settings);
    expect(target.explicit).toBe(false);
    expect(cli.diagnose({ settings, target, reachable: true })).toMatch(/switched off/i);
  });
});
