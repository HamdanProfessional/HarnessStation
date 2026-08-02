/**
 * HTTP, standing in for @tauri-apps/plugin-http.
 *
 * The desktop app uses the plugin because a Rust HTTP client isn't subject to
 * the browser's same-origin policy — it can call any provider from any origin.
 * In the browser there's no getting around CORS, so this is just the native
 * fetch, and the difference is a real product constraint rather than a shim
 * detail:
 *
 *   - Providers that send CORS headers (OpenRouter, Groq, Anthropic with the
 *     anthropic-dangerous-direct-browser-access header, many local servers with
 *     CORS enabled) work directly.
 *   - Providers that don't (OpenAI's api.openai.com historically) are blocked
 *     from the browser and need a proxy the user supplies.
 *   - A local model on http://localhost is blocked by mixed content from an
 *     https page. That's a browser rule, not something the app can waive.
 *
 * The UI surfaces these as ordinary connection errors; this file only moves the
 * bytes it's allowed to.
 */

export const fetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input as RequestInfo, init);
