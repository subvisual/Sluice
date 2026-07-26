import type { Address } from "viem";
import { REQUEST_DEFAULTS } from "./constants";
import type { RecommendationRequest, TokenMeta, TokenSelection } from "./types";

/**
 * Building the request envelope from what the Compose screen collected, plus
 * the checks the CLIENT can honestly make.
 *
 * These are not the validator. Gate 1 (I1–I12) runs over the *model's output*
 * against this request; everything here runs over the *input* before anything
 * is sent, to avoid spending an inference round trip on a request that cannot
 * be satisfied.
 */

export type RequestIssue = {
  /** Stable code so the UI can key on it without matching prose. */
  code:
    | "NO_WALLET"
    | "WRONG_CHAIN"
    | "EMPTY_PROMPT"
    | "NO_TOKENS"
    | "NEED_TWO_TOKENS"
    | "TOO_MANY_TOKENS"
    | "ZERO_AMOUNT"
    | "OVER_BALANCE"
    /**
     * Emitted by the screen, not this builder: an unparseable amount never
     * reaches `selections` (there is no bigint to carry it in), so the
     * component reports it against the raw input.
     */
    | "MALFORMED";
  message: string;
};

export type RequestDraft = {
  user: Address | undefined;
  chainId: number | undefined;
  expectedChainId: number;
  prompt: string;
  selections: TokenSelection[];
  /** Live balances at the current head, keyed by token. Undefined = not yet read. */
  balances: Record<Address, bigint | undefined>;
  tokens: TokenMeta[];
};

export type BuildResult =
  | { ok: true; request: RecommendationRequest; issues: [] }
  | { ok: false; request: null; issues: RequestIssue[] };

export function buildRecommendationRequest(draft: RequestDraft): BuildResult {
  const issues: RequestIssue[] = [];
  const symbolOf = (token: Address) =>
    draft.tokens.find((t) => eq(t.address, token))?.symbol ?? token;

  if (!draft.user) {
    issues.push({ code: "NO_WALLET", message: "Connect a wallet to compose." });
  }

  if (draft.chainId !== undefined && draft.chainId !== draft.expectedChainId) {
    issues.push({
      code: "WRONG_CHAIN",
      message: `Wrong chain: connected to ${draft.chainId}, expected ${draft.expectedChainId}.`,
    });
  }

  if (draft.prompt.trim().length === 0) {
    issues.push({
      code: "EMPTY_PROMPT",
      message: "Describe what you want in your own words.",
    });
  }

  // Exactly two. Every layer below is single-pair: swapvm takes
  // tokens: [string, string], MarketContext carries one pair, and pairingPlan
  // splits that one pair. A one-token budget also has no pair to derive, and
  // full-range's price IS the ratio of the shipped amounts — so one token ships
  // a position with no price. NO_TOKENS keeps meaning *none*: the screen filters
  // on that code when a row is malformed.
  if (draft.selections.length === 0) {
    issues.push({
      code: "NO_TOKENS",
      message: "Select two tokens and set their amounts.",
    });
  } else if (draft.selections.length === 1) {
    issues.push({
      code: "NEED_TWO_TOKENS",
      message: "Pick a second token — a strategy is a pair.",
    });
  } else if (draft.selections.length > 2) {
    issues.push({
      code: "TOO_MANY_TOKENS",
      message: "Two tokens per request — one strategy is one pair.",
    });
  }

  for (const sel of draft.selections) {
    if (sel.amount <= 0n) {
      issues.push({
        code: "ZERO_AMOUNT",
        message: `${symbolOf(sel.token)}: set an amount above zero.`,
      });
      continue;
    }
    // Amount inputs are bounded by the wallet balance — a product affordance,
    // NOT invariant I2. The budget is a ceiling the user declared; the live
    // balance is a separate number checked at observedBlock. An unread balance
    // (undefined) never blocks.
    const balance = draft.balances[sel.token];
    if (balance !== undefined && sel.amount > balance) {
      issues.push({
        code: "OVER_BALANCE",
        message: `${symbolOf(sel.token)}: more than the wallet holds.`,
      });
    }
  }

  if (issues.length > 0 || !draft.user) {
    return { ok: false, request: null, issues };
  }

  // Later duplicate selections would silently overwrite earlier ones, so fold
  // them by adding — the user meant the total they typed across both rows.
  const budget: Record<Address, bigint> = {};
  for (const sel of draft.selections) {
    budget[sel.token] = (budget[sel.token] ?? 0n) + sel.amount;
  }

  return {
    ok: true,
    issues: [],
    request: {
      user: draft.user,
      chainId: draft.expectedChainId,
      prompt: draft.prompt,
      budget,
      ...REQUEST_DEFAULTS,
    },
  };
}

/**
 * JSON-safe view of the request, for display and for the record.
 *
 * `bigint` through `JSON.stringify` throws, and coercing to a JS number is a
 * silent correctness bug — amounts are decimal strings everywhere they leave
 * this process.
 */
export function serializeRequest(request: RecommendationRequest) {
  return {
    user: request.user,
    chainId: request.chainId,
    prompt: request.prompt,
    budget: Object.fromEntries(
      Object.entries(request.budget).map(([token, amount]) => [
        token,
        amount.toString(),
      ]),
    ),
    maxStrategies: request.maxStrategies,
    maxDeadlineSec: request.maxDeadlineSec,
    maxInferenceRetries: request.maxInferenceRetries,
  };
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
