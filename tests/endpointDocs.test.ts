import { describe, expect, it } from "vitest";
// @ts-expect-error — plain ESM, no types; see tests/cli.test.ts.
import * as cli from "../cli/lib.mjs";
import { claudeEnvSnippet, endpointSnippet } from "../src/lib/endpointDocs";

/**
 * The paste-ready endpoint blocks exist twice on purpose: the CLI ships as
 * plain .mjs and cannot import TS, so `cli/lib.mjs` and `src/lib/endpointDocs`
 * each carry the builders. That is only acceptable while their output is
 * identical — this file is the tripwire. If you change one, change both, or
 * better: change this test's fixtures to match the new output in both.
 */
describe("endpoint snippet twins", () => {
  const cases: { base: string; models: string[] }[] = [
    { base: "http://127.0.0.1:11435/v1", models: ["openai/gpt-5", "agent/assistant", "combo/cheap-first"] },
    { base: "http://127.0.0.1:9999/v1", models: [] },
  ];

  for (const [i, c] of cases.entries()) {
    it(`endpointSnippet #${i} renders identically from the CLI and the app`, () => {
      expect(endpointSnippet(c.base, c.models)).toBe(cli.endpointSnippet(c.base, c.models));
      expect(endpointSnippet(c.base, c.models, "  ")).toBe(cli.endpointSnippet(c.base, c.models, "  "));
    });
  }

  it("claudeEnvSnippet renders identically from the CLI and the app", () => {
    for (const base of ["http://127.0.0.1:11435/v1", "http://127.0.0.1:11435"]) {
      for (const model of ["", "groq/llama-3.3-70b"]) {
        expect(claudeEnvSnippet(base, model)).toBe(cli.claudeEnvSnippet(base, model));
      }
    }
  });

  it("the Claude base URL never keeps the /v1 the SDK appends itself", () => {
    expect(claudeEnvSnippet("http://127.0.0.1:11435/v1").split("\n")[0]).toBe(
      "ANTHROPIC_BASE_URL=http://127.0.0.1:11435",
    );
  });
});
