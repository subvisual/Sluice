/**
 * `promptVersion` goes into every trace — F2 §9.
 *
 * When the composer behaves differently at hour 30 than at hour 14, "we edited
 * the prompt" is the most likely answer, and without this recorded that is
 * unanswerable. Bump it whenever anything in `prompt.ts` or the SDK grammar
 * (`arbitration-sdk/src/grammar.ts`) changes.
 *
 * /2: the provisional six-slot grammar and T1–T3 templates were replaced by
 * the SDK grammar — the deployed router's real menu and the settled template
 * set (full-range, full-range-fee, banded, banded-fee).
 */
export const PROMPT_VERSION = "sluice.compose/2";

/** Wire schema of the recommendation the enclave returns — F2 §3. */
export const RECOMMENDATION_SCHEMA = "sluice.recommendation/1";

/**
 * Request limits — F2 §5.
 *
 * Deliberately NOT exposed as knobs in the Compose UI. The demo line is "this
 * is the entire input: a sentence and a budget", and three extra sliders argue
 * against it. They are shown read-only in the request preview.
 */
export const REQUEST_DEFAULTS = {
  /** F1 Q5 will set this properly — it is a gas measurement on the fork, not a guess. */
  maxStrategies: 3,
  maxDeadlineSec: 7 * 24 * 60 * 60,
  maxInferenceRetries: 2,
} as const;

/** Base. Asserted for correctness — see the warning in `wagmi.ts`, it is NOT a mainnet guard. */
export const EXPECTED_CHAIN_ID = 8453;
