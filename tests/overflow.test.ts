import { describe, expect, it } from "vitest";
import { isContextOverflow } from "../src/lib/providers/overflow";

describe("recognising an oversized prompt", () => {
  const REAL = [
    "prompt is too long: 215000 tokens > 200000 maximum",
    "Request too large for gpt-4o in organization org-x",
    "This model's maximum context length is 128000 tokens, however you requested 130000",
    "input is too long for requested model",
    "context_length_exceeded",
    "Input token count 1200000 exceeds the maximum number of tokens allowed",
    "Please reduce the length of the messages",
    "Request Entity Too Large",
    "model_context_window_exceeded",
    "too many tokens in the request",
    "token limit exceeded",
    "prompt too long",
    "your input length 9000 exceeds the model's context length of 8192",
  ];

  for (const m of REAL) {
    it(`spots: ${m.slice(0, 44)}`, () => expect(isContextOverflow(m)).toBe(true));
  }

  it("treats a 413 as overflow whatever the body says", () => {
    // The status is unambiguous on its own: the entity we sent was too large.
    expect(isContextOverflow("", 413)).toBe(true);
    expect(isContextOverflow("something opaque", 413)).toBe(true);
  });
});

describe("what must not be mistaken for it", () => {
  it("does not treat a rate limit as an overflow, even when it mentions tokens", () => {
    // This is the expensive false positive: compacting throws away the user's
    // history to fix a problem that waiting solves. Several providers word
    // their throttle messages in terms of token budgets.
    for (const m of [
      "Rate limit reached for gpt-4o: Limit 30000 tokens per min",
      "rate limit exceeded — too many tokens per minute",
      "Too Many Requests",
      "Throttling error: rate exceeded",
      "You exceeded your current quota, please check your plan",
    ]) {
      expect(isContextOverflow(m), m).toBe(false);
    }
  });

  it("leaves ordinary failures alone", () => {
    for (const m of [
      "Invalid API key provided",
      "model not found",
      "Internal server error",
      "network timeout",
      "",
    ]) {
      expect(isContextOverflow(m), m || "(empty)").toBe(false);
    }
  });

  it("does not fire on a 400 by itself", () => {
    // 400 is the most common status for an overflow *and* for a dozen unrelated
    // client errors, so the status alone proves nothing — only the text does.
    expect(isContextOverflow("Bad Request", 400)).toBe(false);
  });

  it("separates the two things OpenAI calls 'Request too large'", () => {
    // Same three words, two different problems. Bare, it means the prompt
    // exceeds the model's per-request token limit and compacting fixes it.
    expect(isContextOverflow("Request too large for gpt-4o in organization org-x")).toBe(true);
    // With a TPM clause it is a throughput cap: the prompt is a legal size,
    // there is simply no budget left this minute. Compacting there would delete
    // the user's history to fix something waiting solves.
    expect(
      isContextOverflow(
        "Request too large for gpt-4o in organization org-x on tokens per min (TPM): Limit 30000, Requested 40000",
      ),
    ).toBe(false);
  });

  it("puts the exclusions ahead of the patterns", () => {
    // "Rate limit ... too many tokens" matches an overflow pattern and an
    // exclusion. The exclusion has to win, or throttles compact the chat.
    expect(isContextOverflow("Rate limit reached: too many tokens")).toBe(false);
  });

  it("survives a null-ish message without throwing", () => {
    expect(isContextOverflow(undefined as unknown as string)).toBe(false);
  });
});
