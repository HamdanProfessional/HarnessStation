import { describe, expect, it } from "vitest";
import { parseSkill, skillIndexPrompt, skillMarkdown, slugify, type Skill } from "../src/lib/skills";

const skill = (over: Partial<Skill> = {}): Skill => ({
  slug: "weekly-report",
  name: "Weekly report",
  description: "Use for status reports.",
  enabled: true,
  files: [],
  ...over,
});

describe("parseSkill", () => {
  it("splits frontmatter from the body", () => {
    const { meta, body } = parseSkill("---\nname: Weekly report\ndescription: Do a thing\n---\n\n# Steps\n1. go");
    expect(meta).toEqual({ name: "Weekly report", description: "Do a thing" });
    expect(body).toBe("# Steps\n1. go");
  });

  it("handles CRLF line endings", () => {
    const { meta, body } = parseSkill("---\r\nname: X\r\n---\r\nbody text");
    expect(meta.name).toBe("X");
    expect(body).toBe("body text");
  });

  it("keeps colons inside a value", () => {
    const { meta } = parseSkill("---\ndescription: Use when: the user asks\n---\nb");
    expect(meta.description).toBe("Use when: the user asks");
  });

  it("returns the whole document when there is no frontmatter", () => {
    const md = "# Just markdown";
    expect(parseSkill(md)).toEqual({ meta: {}, body: md });
  });

  it("round-trips with skillMarkdown", () => {
    const { meta, body } = parseSkill(skillMarkdown("Name", "Desc", "  Body  "));
    expect(meta.name).toBe("Name");
    expect(meta.description).toBe("Desc");
    expect(body).toBe("Body");
  });
});

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("Weekly Report!")).toBe("weekly-report");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  --Hello, World--  ")).toBe("hello-world");
  });

  it("caps length at 48 chars", () => {
    expect(slugify("a".repeat(80))).toHaveLength(48);
  });

  it("falls back to a generated id when nothing survives", () => {
    expect(slugify("!!!")).toMatch(/^skill-\d+$/);
  });
});

describe("skillIndexPrompt", () => {
  it("is empty when no skill is usable", () => {
    expect(skillIndexPrompt([])).toBe("");
    expect(skillIndexPrompt([skill({ enabled: false })])).toBe("");
    expect(skillIndexPrompt([skill({ description: "" })])).toBe("");
  });

  it("lists slug, name and description of usable skills only", () => {
    const out = skillIndexPrompt([skill(), skill({ slug: "off", name: "Off", enabled: false })]);
    expect(out).toContain("- weekly-report: Weekly report — Use for status reports.");
    expect(out).not.toContain("Off");
    expect(out).toContain("use_skill");
  });
});
