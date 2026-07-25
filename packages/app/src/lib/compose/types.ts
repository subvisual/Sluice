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

/**
 * Market context — F3. Composed from hosted subgraphs against real Base, plus
 * the user's own book from our local graph-node.
 *
 * Every field is nullable on purpose. F3 is not wired yet, and a prompt that
 * invents pool depth is worse than one that admits it has none: "a
 * recommendation made without realised volatility is a guess with good grammar."
 */
export type MarketContext = {
  observedAt: number;
  observedBlock: number;
  pair: {
    tokens: [Address, Address];
    feeTierBps: number | null;
    poolDepthUsd: string | null;
    realizedVol1h: string | null;
    realizedVol24h: string | null;
    volume24hUsd: string | null;
  } | null;
  /** What this wallet already has shipped. Empty array ≠ unknown. */
  book:
    | Array<{
        strategyHash: string;
        templateId: string;
        tokens: Address[];
        virtualAmounts: string[];
        consumed: string[];
        deadline: number;
      }>
    | null;
};

/** One rejected attempt, carried forward across retries — F2 §4. */
export type ViolationRecord = {
  attempt: number;
  /** e.g. "I2" */
  invariant: string;
  message: string;
};

/** The assembled prompt. Nothing here has been sent anywhere. */
export type ComposePrompt = {
  promptVersion: string;
  system: string;
  user: string;
};
