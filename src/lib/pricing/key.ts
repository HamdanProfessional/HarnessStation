/**
 * Model-key canonicalization.
 *
 * A leaf module with no imports: the chat cost path needs this synchronously on
 * every rendered message, and must not drag the catalog, the source adapters or
 * the Tauri HTTP plugin in behind it.
 */

/**
 * Strip the vendor namespace and cosmetic punctuation so the same model can be
 * recognised across feeds: `anthropic/claude-opus-5` and `claude-opus-5`
 * collapse to the same canonical key.
 *
 * Deliberately conservative — it does not try to unify `gpt-4o` with
 * `gpt-4o-2024-08-06`, because those genuinely differ in price. It removes the
 * vendor prefix, any `:free`-style suffix, and separators, and nothing else.
 */
export function canonicalModelKey(modelKey: string): string {
  const withoutVendor = modelKey.includes("/")
    ? modelKey.slice(modelKey.indexOf("/") + 1)
    : modelKey;
  return withoutVendor
    .toLowerCase()
    .replace(/[:@].*$/, "")
    .replace(/[^a-z0-9]+/g, "");
}
