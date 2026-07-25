/**
 * The slot grammar — F1 §5.
 *
 * ⚠️ PROVISIONAL. F1 Open Q2 is unsettled, and the page is explicit: "do not
 * build the validator against this table until the fork says which." So this
 * module is DATA, injected into the prompt builder rather than baked into it —
 * when Q2 closes against the forked bytecode, this file changes and nothing
 * else does.
 *
 * The prompt includes the grammar verbatim even though the validator enforces
 * it independently. Not for safety — the validator is the safety — but because
 * a model that knows the constraints complies on the first attempt far more
 * often, and every retry is a full round trip a *user is waiting on*.
 */

export type SlotSpec = {
  index: number;
  name: string;
  options: string[];
  required: "yes" | "optional" | "exactly one" | "always";
};

export type SlotGrammar = {
  provisional: boolean;
  /** Rendered in the UI, never in the prompt — the model does not need our doubts. */
  provisionalReason: string;
  slots: SlotSpec[];
  rules: string[];
};

export const SLOT_GRAMMAR: SlotGrammar = {
  provisional: true,
  provisionalReason:
    "F1 Q2 is open. T1 pairs _xycConcentrateGrowLiquidityXD with _limitSwap1D, which slot 3's " +
    '"exactly one" rule forbids — and T1 comes from a set verified against the 1inch source, so ' +
    "the table is the more likely thing to be wrong. The likely correction is that the curve and " +
    "the fill mode are two distinct slots. _decayXD is also unplaced. Settle against the forked " +
    "bytecode before the validator is built.",

  slots: [
    {
      index: 1,
      name: "balance setup",
      options: ["per-token setup"],
      required: "yes",
    },
    {
      index: 2,
      name: "fees",
      options: ["fee configuration"],
      required: "optional",
    },
    {
      index: 3,
      name: "swap logic",
      options: [
        "_xycConcentrateGrowLiquidityXD",
        "_xycConcentrateGrowLiquidity2D",
        "_limitSwap1D",
        "_limitSwapOnlyFull1D",
        "_dynamicBalancesXD",
      ],
      required: "exactly one",
    },
    {
      index: 4,
      name: "oracle adjust",
      options: ["_oraclePriceAdjuster1D"],
      required: "optional",
    },
    {
      index: 5,
      name: "invalidation",
      options: [
        "_invalidateTokenIn1D",
        "_invalidateTokenOut1D",
        "_invalidateBit1D",
      ],
      required: "yes",
    },
    {
      index: 6,
      name: "deadline",
      options: ["_deadline"],
      required: "always",
    },
  ],

  rules: [
    "Partial fill requires token invalidation. If slot 3 is _limitSwap1D, slot 5 MUST be _invalidateTokenIn1D or _invalidateTokenOut1D. Aqua's own docs mark this as required to prevent overfill.",
    "Exactly one swap-logic instruction. Two is not a richer strategy; it is undefined behaviour.",
    "_deadline is ALWAYS present, and within the bounds the request declared.",
    "Amounts stay within the user's stated budget, PER TOKEN. Never commit a token the user did not select, and never more of it than they allowed. Splitting a budget across several strategies means dividing it, not repeating it.",
    "The oracle adjuster (slot 4) requires a price feed for the pair. Do not select it for a pair with no feed.",
    "You emit a SLOT ASSIGNMENT — structured data naming which instruction fills each slot, with parameters. You NEVER emit bytecode, and you never state an instruction order: ordering is a property of our compiler, not of your output.",
  ],
};
