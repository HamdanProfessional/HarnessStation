import { describe, expect, it } from "vitest";
import { applySnippet, filterSnippets, findSnippetTrigger } from "../src/lib/snippets";
import type { Template } from "../src/lib/types";

const tpl = (id: string, name: string, kind?: Template["kind"], content = ""): Template => ({
  id,
  name,
  content,
  ...(kind ? { kind } : {}),
});

describe("findSnippetTrigger", () => {
  it("triggers on a bare slash at the start", () => {
    expect(findSnippetTrigger("/")).toEqual({ query: "", start: 0, end: 1 });
  });

  it("captures the query typed after the slash", () => {
    expect(findSnippetTrigger("/rele")).toEqual({ query: "rele", start: 0, end: 5 });
  });

  it("triggers after whitespace but not mid-word (URLs stay untouched)", () => {
    expect(findSnippetTrigger("hello /wor")?.query).toBe("wor");
    // A URL's slash follows non-whitespace — no trigger.
    expect(findSnippetTrigger("https://x.com/a")).toBeNull();
    expect(findSnippetTrigger("path/to thing")).toBeNull();
  });

  it("does not trigger for a lone slash preceded by text without space", () => {
    expect(findSnippetTrigger("abc/")).toBeNull();
  });

  it("stays closed when the caret sits before the slash", () => {
    // Draft is "/re" with the caret moved back to the very start.
    expect(findSnippetTrigger("")).toBeNull();
    // Draft "x /re" with the caret just after "x".
    expect(findSnippetTrigger("x /re".slice(0, 1))).toBeNull();
  });

  it("works on later lines of a multi-line draft", () => {
    const textBeforeCaret = "first line\nsecond /q";
    expect(findSnippetTrigger(textBeforeCaret)).toEqual({
      query: "q",
      start: 18,
      end: 20,
    });
  });

  it("closes once a space follows the query — the pick must happen first", () => {
    expect(findSnippetTrigger("/foo bar")).toBeNull();
    // While the query itself is still being typed, everything matches.
    expect(findSnippetTrigger("/foo bar".slice(0, 4))).toEqual({ query: "foo", start: 0, end: 4 });
  });
});

describe("applySnippet", () => {
  it("replaces exactly the trigger token", () => {
    const draft = "say /hello";
    const out = applySnippet(draft, findSnippetTrigger(draft)!, "HELLO THERE");
    expect(out).toBe("say HELLO THERE");
  });

  it("inserts at the start of an empty-ish draft", () => {
    const out = applySnippet("/", findSnippetTrigger("/")!, "line1\nline2");
    expect(out).toBe("line1\nline2");
  });

  it("removes the token cleanly (used when saving the draft as a snippet)", () => {
    const draft = "draft text /snip";
    expect(applySnippet(draft, findSnippetTrigger(draft)!, "")).toBe("draft text ");
  });

  it("keeps whatever followed the caret-side token", () => {
    // Caret right after "/he", with " world" still ahead of it in the draft.
    const draft = "/he world";
    const trig = findSnippetTrigger(draft.slice(0, 3));
    expect(trig).not.toBeNull();
    expect(applySnippet(draft, trig!, "hi")).toBe("hi world");
  });
});

describe("filterSnippets", () => {
  const list = [
    tpl("a", "Alpha"),
    tpl("b", "beta snippet", "snippet"),
    tpl("c", "alphabet"),
    tpl("d", "delta snippet", "snippet"),
  ];

  it("orders snippets first, then templates, alphabetical within each group", () => {
    expect(filterSnippets(list, "").map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("filters case-insensitively by name", () => {
    expect(filterSnippets(list, "ALP").map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("ranks prefix matches above substring matches, even across kinds", () => {
    const list2 = [
      tpl("x", "research notes"),
      tpl("y", "my research", "snippet"),
      tpl("z", "research", "snippet"),
    ];
    // z starts with the query and is a snippet; x starts with it too, so both
    // beat the mid-name match y despite y being a snippet.
    expect(filterSnippets(list2, "research").map((t) => t.id)).toEqual(["z", "x", "y"]);
  });

  it("returns everything for a blank query regardless of kind", () => {
    expect(filterSnippets(list, "   ")).toHaveLength(4);
  });
});
