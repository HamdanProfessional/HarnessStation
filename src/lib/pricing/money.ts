/**
 * Money helpers.
 *
 * The reference implementation used Python `Decimal` end-to-end because float
 * arithmetic on cents can flip the order of two near-identical offers — and a
 * comparison tool whose ordering wobbles between identical queries is worse
 * than useless. JavaScript has no decimal type and a bignum dependency is not
 * worth it here, so the same guarantee is bought a cheaper way: every value
 * that feeds a comparison or a tie-break goes through `quantize()` first.
 *
 * Rounding to 8 decimal places is well inside the precision of a double for the
 * magnitudes involved (token prices span ~1e-3 to ~1e3 USD/Mtok), so two prices
 * that are equal to 8dp compare equal, deterministically, every time.
 */

const SCALE = 1e8;

/** Round to 8 decimal places. Comparisons and sorts must use this. */
export function quantize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * SCALE) / SCALE;
}

/** Parse a number that may arrive as a string, "", null or a sentinel. */
export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

/**
 * Per-token price string → per-million-token number.
 *
 * `"0"` is a real price — free models exist — and must survive as `0` rather
 * than becoming `undefined`. A negative value is OpenRouter's sentinel for
 * "priced dynamically upstream", which is genuinely unknown: not free, not an
 * error, and not a number we are entitled to invent.
 */
export function perTokenToMtok(value: unknown): number | undefined {
  const n = toNumber(value);
  if (n === undefined) return undefined;
  if (n < 0) return undefined;
  return quantize(n * 1_000_000);
}

/** USD, formatted for a dense table. */
export function usd(value: number | undefined, opts: { precise?: boolean } = {}): string {
  if (value === undefined) return "—";
  if (value === 0) return "free";
  if (opts.precise || value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}

/** "$3.00 / Mtok" style label. */
export function perMtok(value: number | undefined): string {
  if (value === undefined) return "—";
  if (value === 0) return "free";
  return `${usd(value)}/M`;
}

/**
 * Blended per-Mtok rate at a given input:output mix.
 *
 * 3:1 is the default because it matches the ratio the app's Benchmarks view
 * already uses, so the two surfaces cannot quote different "blended" numbers
 * for the same model.
 */
export function blended(
  input: number | undefined,
  output: number | undefined,
  inputPerOutput = 3,
): number | undefined {
  if (input === undefined && output === undefined) return undefined;
  const i = input ?? 0;
  const o = output ?? 0;
  const total = inputPerOutput + 1;
  return quantize((i * inputPerOutput + o) / total);
}
