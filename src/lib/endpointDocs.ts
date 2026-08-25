/**
 * Paste-ready configuration blocks for pointing external tools at the local
 * API. Dependency-free on purpose: `cli/lib.mjs` ships the same two builders
 * (the CLI has no build step and cannot import TS), so these are twins by
 * design — `tests/endpointDocs.test.ts` renders both and fails if they ever
 * drift. The token rides in every block because the loopback server checks it
 * on every request; a config without it gets a 401 and a confused user.
 */

/** An OpenAI-compatible provider block, e.g. for opencode's config. */
export function endpointSnippet(base: string, models: string[], indent = "", apiKey = ""): string {
  const list = models.map((m) => `${indent}      "${m}"`).join(",\n");
  return `${indent}{
${indent}  "provider": {
${indent}    "api": "openai",
${indent}    "baseUrl": "${base}",
${indent}    "apiKey": "${apiKey}",
${indent}    "models": [
${list}
${indent}    ]
${indent}  }
${indent}}`;
}

/**
 * Environment for pointing Claude Code at the app. The Anthropic SDK appends
 * /v1/messages itself, so the base URL must not include it.
 */
export function claudeEnvSnippet(base: string, model = "", token = ""): string {
  const root = base.replace(/\/v1\/?$/, "");
  const m = model || "provider/model — see `hs models`";
  const t = token || "(missing — start the desktop app once, then re-run `hs endpoint`)";
  return [
    `ANTHROPIC_BASE_URL=${root}`,
    `ANTHROPIC_AUTH_TOKEN=${t}`,
    `ANTHROPIC_MODEL=${m}`,
    `ANTHROPIC_SMALL_FAST_MODEL=${m}`,
  ].join("\n");
}
