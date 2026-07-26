import type { Address } from "viem";

/**
 * The request envelope — F2 §5.
 *
 * Built per request from the user's own input, NOT declared once in a config
 * file. This is the biggest structural change from the superseded daemon
 * design, where the equivalent object was a long-lived "mandate".
 */
export type RecommendationRequest = {
  user: Address;
  chainId: number;
  /** The user's words, verbatim. Never paraphrased, trimmed of meaning, or "cleaned up". */
  prompt: string;
  /**
   * Tokens THEY selected, amounts THEY set, in base units.
   *
   * This is a CEILING THE USER DECLARED, not an observation of their balance.
   * There is no stored `realBalance` anywhere in this system — every balance
   * check evaluates against a live snapshot at `observedBlock`. Conflating the
   * two is how you recommend committing tokens the user did not offer.
   */
  budget: Record<Address, bigint>;
  /** How many strategies the Multicall may carry. */
  maxStrategies: number;
  maxDeadlineSec: number;
  /** Default 2, then the template fallback. */
  maxInferenceRetries: number;
};

/** A token the user may select. Sourced from `config/addresses.8453.json`. */
export type TokenMeta = {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
};

/** One row of the token picker: a token plus the amount the user typed. */
export type TokenSelection = {
  token: Address;
  /** Base units. Never a JS number — a float here is a silent correctness bug. */
  amount: bigint;
};
