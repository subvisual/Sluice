import { keccak256, toHex, type Hex } from "viem";

/**
 * Strategy templates — F1 §4.
 *
 * Templates are KNOWN-GOOD STARTING SHAPES, not the product. The model selects
 * and parameterises within the grammar; a template gives it a sane seed and
 * gives us something to test against before the composer works.
 *
 * A template is not a strategy. Nothing here gets shipped as-is.
 */

export type TemplateSeed = {
  slug: string;
  label: string;
  /** Fed to the composer verbatim as the intent this shape serves. */
  describesIntent: string;
  /** Instruction names only. NOT an order — the compiler owns order (F1 P3). */
  shape: string[];
  /** The honest tradeoff, so the model picks on merit rather than on name. */
  tradeoff: string;
};

/**
 * `templateId` is `Hex32`. Derived rather than assigned so there are no magic
 * constants to drift: F1 owns the final derivation, and if it chooses
 * differently this is the one function that changes.
 */
export function templateId(slug: string): Hex {
  return keccak256(toHex(`sluice.template/${slug}`));
}

export const TEMPLATES: TemplateSeed[] = [
  {
    slug: "tight-clmm",
    label: "T1 · tight-clmm — flow capture",
    describesIntent: "earn fees on a pair I expect to stay rangebound",
    shape: [
      "_xycConcentrateGrowLiquidityXD over a narrow band",
      "_limitSwap1D for partial fills",
      "_invalidateTokenIn1D",
      "_deadline",
    ],
    tradeoff: "High fill rate, thin edge.",
  },
  {
    slug: "wide-clmm",
    label: "T2 · wide-clmm — patient liquidity",
    describesIntent: "I want exposure but I am not confident about the range",
    shape: ["same shape as T1, wider band"],
    tradeoff: "Fills rarely, holds a large commitment.",
  },
  {
    slug: "oracle-limit",
    label: "T3 · oracle-limit — a level, not a range",
    describesIntent: "sell my ETH if it reaches X — a target, executed all-or-nothing",
    shape: [
      "_limitSwapOnlyFull1D",
      "_oraclePriceAdjuster1D",
      "_invalidateBit1D",
      "_deadline",
    ],
    tradeoff:
      "All-or-nothing, so its worst case is discontinuous: it can draw its full amount in a single fill. This is the template whose sizing actually matters.",
  },
];
