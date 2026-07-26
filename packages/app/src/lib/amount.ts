import { formatUnits, parseUnits } from "viem";

/**
 * Parse a typed decimal amount into base units.
 *
 * Returns `null` for anything that is not an exact representation, INCLUDING
 * more decimal places than the token has. `viem.parseUnits` rounds a too-long
 * fraction, and rounding a ceiling upward hands the composer more budget than
 * the user typed.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const [, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) return null;

  try {
    const parsed = parseUnits(trimmed, decimals);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Thousands grouped with a no-break space ("12 000.00") — commas read as
 * decimal separators to half the audience.
 */
const groupWhole = (whole: string) =>
  BigInt(whole).toLocaleString("en-US").replace(/,/g, " ");

/** Display helper. Trims trailing zeros so balances read like balances. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 6) {
  const full = formatUnits(value, decimals);
  const [whole, fraction] = full.split(".");
  const grouped = groupWhole(whole);
  if (!fraction) return grouped;
  const clipped = fraction.slice(0, maxFrac).replace(/0+$/, "");
  return clipped ? `${grouped}.${clipped}` : grouped;
}

/**
 * Fixed-width display for committed amounts ("12 000.00", "4.0000"): always
 * exactly `frac` fraction digits, truncated never rounded — rounding a ceiling
 * up would display more budget than authorised.
 */
export function formatFixed(value: bigint, decimals: number, frac: number) {
  const full = formatUnits(value, decimals);
  const [whole, fraction = ""] = full.split(".");
  const grouped = groupWhole(whole);
  if (frac === 0) return grouped;
  return `${grouped}.${fraction.slice(0, frac).padEnd(frac, "0")}`;
}

/** How many fraction digits an amount of this token shows on cards/tables. */
export function displayFrac(decimals: number) {
  return decimals <= 6 ? 2 : 4;
}
