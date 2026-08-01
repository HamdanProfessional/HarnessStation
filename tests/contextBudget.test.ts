import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_SHARE,
  MAX_MEMORY_SHARE,
  contextWindowFor,
  estimateTokens,
  memoryBudget,
  trimToBudget,
} from "../src/lib/contextBudget";

describe("contextWindowFor", () => {
  it("reads an explicit size out of the model name", () => {
    expect(contextWindowFor("qwen2.5-7b-instruct-128k")).toBe(128_000);
    expect(contextWindowFor("some-model:32k")).toBe(32_000);
    expect(contextWindowFor("minimax-text-1m")).toBe(1_000_000);
  });

  it("knows the common families", () => {
    expect(contextWindowFor("gpt-4o")).toBe(128_000);
    expect(contextWindowFor("claude-sonnet-5")).toBe(200_000);
    expect(contextWindowFor("llama-2-7b-chat")).toBe(4_096);
    expect(contextWindowFor("mistral-7b-instruct")).toBe(32_768);
  });

  it("prefers a size in the name over the family default", () => {
    // A served/quantised variant is what the user actually loaded.
    expect(contextWindowFor("llama-2-7b-32k")).toBe(32_000);
  });

  it("guesses small for anything unrecognised", () => {
    // Under-guessing trims a few facts; over-guessing breaks the request.
    expect(contextWindowFor("some-homemade-gguf")).toBe(8_192);
    expect(contextWindowFor("")).toBe(8_192);
  });
});

describe("memoryBudget", () => {
  it("is a share of the window, not a fixed size", () => {
    expect(memoryBudget("gpt-4o")).toBe(Math.floor(128_000 * DEFAULT_MEMORY_SHARE));
    expect(memoryBudget("llama-2-7b-chat")).toBe(Math.floor(4_096 * DEFAULT_MEMORY_SHARE));
  });

  it("never exceeds the ceiling, whatever share is asked for", () => {
    expect(memoryBudget("gpt-4o", 0.9)).toBe(Math.floor(128_000 * MAX_MEMORY_SHARE));
    expect(MAX_MEMORY_SHARE).toBeLessThanOrEqual(0.25);
  });

  it("can be switched off entirely", () => {
    expect(memoryBudget("gpt-4o", 0)).toBe(0);
  });

  it("leaves a small local model room to actually work", () => {
    // The case that motivated this: a big store against an 8k model.
    const budget = memoryBudget("gemma-2-2b");
    expect(budget).toBeLessThan(8_192 * 0.25);
    expect(budget).toBeGreaterThan(0);
  });
});

describe("trimToBudget", () => {
  const facts = (n: number, len = 40) =>
    Array.from({ length: n }, (_, i) => `fact ${i} ${"x".repeat(len)}`);

  it("keeps everything when it fits", () => {
    const r = trimToBudget(facts(3), 10_000);
    expect(r.kept).toHaveLength(3);
    expect(r.dropped).toBe(0);
  });

  it("drops the least relevant tail, keeping the order it was given", () => {
    // recall() returns them ranked, so the tail is the least relevant.
    const all = facts(50);
    const r = trimToBudget(all, 100);
    expect(r.kept.length).toBeLessThan(50);
    expect(r.dropped).toBe(50 - r.kept.length);
    expect(r.kept[0]).toBe(all[0]);
    expect(r.kept).toEqual(all.slice(0, r.kept.length));
  });

  it("stays inside the budget", () => {
    for (const budget of [50, 200, 1000]) {
      const r = trimToBudget(facts(200), budget);
      expect(r.tokens).toBeLessThanOrEqual(budget);
    }
  });

  it("keeps nothing when there is no budget", () => {
    const r = trimToBudget(facts(5), 0);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toBe(5);
  });

  it("truncates one over-long fact rather than silently dropping everything", () => {
    const r = trimToBudget(["y".repeat(5000)], 60);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0].endsWith("…")).toBe(true);
    expect(estimateTokens(r.kept[0])).toBeLessThanOrEqual(60);
  });

  it("handles an empty store", () => {
    expect(trimToBudget([], 100)).toEqual({ kept: [], dropped: 0, tokens: 0 });
  });
});

describe("estimateTokens", () => {
  it("over-counts slightly rather than under-counting", () => {
    // Being wrong high costs a dropped fact; being wrong low breaks the request.
    const text = "the quick brown fox jumps over the lazy dog";
    expect(estimateTokens(text)).toBeGreaterThan(text.split(/\s+/).length);
  });

  it("is zero for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
