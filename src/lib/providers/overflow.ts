/**
 * Recognising "your prompt is too long" across providers.
 *
 * This is the one request failure with an obvious automatic fix — compact the
 * conversation and send it again — and we were treating it as a generic error.
 * `isRetryableError` classes 400 as fatal, so an overflow ended the turn with a
 * raw provider string, and failing over to another key would have been useless
 * anyway: the next key gets the same oversized prompt.
 *
 * There is no status code that means this. 400 is the common answer, 413 shows
 * up, and some providers return 500. The message text is the only reliable
 * signal, and every provider words it differently — hence the list.
 *
 * Patterns adapted from opencode's `provider-error.ts` (MIT), which accumulated
 * them by running against far more providers than we have. The exclusions
 * matter as much as the patterns: several providers mention token limits in
 * their *rate-limit* messages, and treating a throttle as an overflow would
 * compact the user's history away for no reason at all.
 */

const OVERFLOW = [
  /prompt is too long/i,
  /request_too_large/i,
  /request too large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length/i,
  /is longer than the model'?s context length/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long/i,
  /too large for model with \d+ maximum context length/i,
  /model_context_window_exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
];

/**
 * Messages that mention limits but mean "slow down", not "send less".
 *
 * Checked first. Compacting in response to a rate limit would destroy history
 * to fix a problem that waiting solves, and the wait is already handled by
 * `backoff.ts`.
 */
const NOT_OVERFLOW = [
  /rate limit/i,
  /too many requests/i,
  /^(throttling error|service unavailable):/i,
  /quota/i,
  // OpenAI reuses "Request too large" for a per-minute throughput cap:
  // "Request too large for gpt-4o ... on tokens per min (TPM): Limit 30000".
  // That is a throttle wearing an overflow's words — the prompt is a legal
  // size, there is just no budget left this minute. Compacting would delete
  // the user's history to solve a problem that waiting solves.
  /tokens per (min|day|hour)|\b(tpm|tpd|rpm)\b/i,
];

/** Whether a provider's error text means the prompt itself was too big. */
export function isContextOverflow(message: string, status?: number): boolean {
  const m = message ?? "";
  if (NOT_OVERFLOW.some((re) => re.test(m))) return false;
  if (OVERFLOW.some((re) => re.test(m))) return true;
  // 413 is unambiguous on its own: the entity we sent was too large.
  return status === 413;
}
