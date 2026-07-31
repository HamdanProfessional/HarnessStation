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
