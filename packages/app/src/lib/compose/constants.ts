/** Wire schema of the recommendation the enclave returns. */
export const RECOMMENDATION_SCHEMA = "sluice.recommendation/1";

/**
 * Request limits. Deliberately NOT exposed as knobs in the Compose UI — the
 * demo line is "this is the entire input: a sentence and a budget". Shown
 * read-only in the request preview.
 */
export const REQUEST_DEFAULTS = {
  /** To be set from a gas measurement on the fork, not a guess. */
  maxStrategies: 3,
  maxDeadlineSec: 7 * 24 * 60 * 60,
  maxInferenceRetries: 2,
} as const;

/** Base. Asserted for correctness — see the warning in `wagmi.ts`, it is NOT a mainnet guard. */
export const EXPECTED_CHAIN_ID = 8453;
