/** Turn a tool/function name into a human label: get_current_time -> "Get Current Time". */
export function prettyName(name: string): string {
  return name
    .replace(/[_-]+/g, " ") // snake / kebab -> spaces
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> spaced
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * A name safe to use as an id segment: "Research Chain" -> "research-chain".
 * Same rules the local API uses for agent slugs, so `combo/<slug>` ids stay
 * consistent everywhere a model id can appear.
 */
export function slugifyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
