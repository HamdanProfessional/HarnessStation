import { describe, expect, it } from "vitest";
import { agentSlug, stringifyContent } from "../src/lib/localApi";

describe("local API helpers", () => {
  it("slugs agent names so they survive as model ids", () => {
    expect(agentSlug("Research Assistant")).toBe("research-assistant");
    expect(agentSlug("  Weird__Name!! ")).toBe("weird-name");
    expect(agentSlug("already-slug")).toBe("already-slug");
  });

  it("flattens OpenAI array-of-parts content to plain text", () => {
    expect(stringifyContent("hello")).toBe("hello");
    expect(
      stringifyContent([
        { type: "text", text: "one " },
        { type: "text", text: "two" },
      ]),
    ).toBe("one two");
    // Non-text parts (e.g. image_url) contribute nothing rather than "[object]".
    expect(stringifyContent([{ type: "image_url", image_url: { url: "x" } }, "!"])).toBe("!");
    expect(stringifyContent(null)).toBe("");
  });
});
