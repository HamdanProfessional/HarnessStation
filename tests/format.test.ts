import { describe, expect, it } from "vitest";
import { prettyName } from "../src/lib/format";

describe("prettyName", () => {
  it("titles snake_case tool names", () => {
    expect(prettyName("get_current_time")).toBe("Get Current Time");
  });

  it("splits camelCase and kebab-case", () => {
    expect(prettyName("readFileSync")).toBe("Read File Sync");
    expect(prettyName("web-search")).toBe("Web Search");
  });

  it("collapses mixed separators and stray whitespace", () => {
    expect(prettyName("  run__terminal-cmd  ")).toBe("Run Terminal Cmd");
  });

  it("keeps digits attached to their word", () => {
    expect(prettyName("generate_3d")).toBe("Generate 3d");
  });

  it("returns empty for empty input", () => {
    expect(prettyName("")).toBe("");
  });
});
