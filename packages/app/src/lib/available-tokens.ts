import type { Address } from "viem";
import type { TokenMeta } from "./compose/types";

/**
 * Which of the offered tokens this wallet can actually compose with.
 *
 * A token is hidden ONLY on a confirmed zero — a balance read that succeeded
 * and returned 0n. `useTokenBalances` returns `undefined` for a balance it has
 * not observed (not read yet, or the read failed), deliberately distinct from
 * `0n`, and that distinction is the whole point here: hiding on `undefined`
 * would let one slow or failed RPC call empty the picker with nothing on screen
 * to act on and no way to tell "you hold none of these" from "we don't know".
 *
 * Pure — no React, no wagmi, no clock. The three buckets exist so the picker
 * can say which of those two situations it is in without re-deriving it.
 */
export type Availability = {
  /** Confirmed above zero, or not yet observed. Rendered, in input order. */
  shown: TokenMeta[];
  /** Read succeeded and returned exactly 0n. The only hidden case. */
  hiddenZero: TokenMeta[];
  /** Not observed. A subset of `shown`, not an alternative to it. */
  unknown: TokenMeta[];
};

export function availableTokens(
  tokens: TokenMeta[],
  balances: Record<Address, bigint | undefined>,
): Availability {
  const shown: TokenMeta[] = [];
  const hiddenZero: TokenMeta[] = [];
  const unknown: TokenMeta[] = [];

  for (const token of tokens) {
    const balance = balances[token.address];
    if (balance === undefined) {
      shown.push(token);
      unknown.push(token);
    } else if (balance === 0n) {
      hiddenZero.push(token);
    } else {
      shown.push(token);
    }
  }

  return { shown, hiddenZero, unknown };
}
