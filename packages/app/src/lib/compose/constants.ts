/**
 * Request limits — F2 §5.
 *
 * Deliberately NOT exposed as knobs in the Compose UI. The demo line is "this
 * is the entire input: a sentence and a budget", and three extra sliders argue
 * against it. They are shown read-only in the request preview.
 */
export const REQUEST_DEFAULTS = {
  /** F1 Q5 will set this properly — it is a gas measurement on the fork, not a guess. */
  maxStrategies: 1,
  maxDeadlineSec: 7 * 24 * 60 * 60,
  maxInferenceRetries: 2,
} as const;

/** Base. Asserted for correctness — see the warning in `wagmi.ts`, it is NOT a mainnet guard. */
export const EXPECTED_CHAIN_ID = 8453;
