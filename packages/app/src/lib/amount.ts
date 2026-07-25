import { formatUnits, parseUnits } from "viem";

/**
 * Parse a typed decimal amount into base units.
 *
 * Returns `null` for anything that is not an exact representation, INCLUDING
 * more decimal places than the token has. `viem.parseUnits` rounds a too-long
 * fraction, and rounding a ceiling upward hands the composer more budget than
 * the user typed — a small silent bug on the one number that must not be
 * silently wrong.
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

/** Display helper. Trims trailing zeros so balances read like balances. */
export function formatAmount(value: bigint, decimals: number, maxFrac = 6) {
  const full = formatUnits(value, decimals);
  const [whole, fraction] = full.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  if (!fraction) return grouped;
  const clipped = fraction.slice(0, maxFrac).replace(/0+$/, "");
  return clipped ? `${grouped}.${clipped}` : grouped;
}
