// Deterministic budget & authority validator — the grammar-independent slice
// of the F2 §6 invariant set (I1–I4, I12). It REJECTS; it never mutates and
// never rewrites (F2 §4: "nothing is ever edited. Violations reject and
// re-infer"). A pure function of (recommendation, request, chain state).
//
// SCOPE — this is deliberately NOT the full validator. It implements the five
// invariants that do not depend on the F1 slot grammar:
//
//   I1  every token in r is a token the user selected in q.budget
//   I2  per token: Σ virtualAmounts across ALL strategies <= q.budget[token]
//   I3  r.strategies.length in [1, q.maxStrategies]
//   I4  r.chainId == config chain (the r.user == q.user half is committer-
//       supplied and deferred with the commit path — see F2 §2/§5)
//   I12 observedBlock within N blocks of head (stale-snapshot guard)
//
// The grammar invariants (I5–I11, I14) are BLOCKED on F1 Open Q2 — §5 is
// provisional and "the validator must not be built against it" until the
// grammar is settled against the forked bytecode. I13 (nonce) is deferred with
// on-chain replay, and I15 is parked (whole-balance mode only). None of those
// may be emitted here.

import type {
	RecommendationRequest,
	StrategyRecommendation,
} from "./recommendation.ts";

// One rejection. `code` is the invariant id so a caller (and the trace) can
// see exactly which rule fired; `message` is human-facing.
export type Violation = {
	code: "I1" | "I2" | "I3" | "I4" | "I12";
	message: string;
};

// The live chain facts the freshness/authority checks need. Stands in for the
// "s: ChainState" argument in F2 §6. `chainId` is the config chain the
// recommendation must target; `headBlock` is the current head; `maxBlockLag` is
// the I12 staleness policy (defaults to DEFAULT_MAX_BLOCK_LAG).
export type ChainState = {
	chainId: number;
	headBlock: number;
	maxBlockLag?: number;
};

// How many blocks behind head an observation may be before it is stale. Base
// blocks are ~2s, so ~50 blocks ≈ 100s — a snapshot older than that was priced
// against a market that has since moved.
export const DEFAULT_MAX_BLOCK_LAG = 50;

const DECIMAL = /^\d+(\.\d+)?$/;

// Number of fractional digits in a decimal string ("1.25" -> 2, "3" -> 0).
function fracLen(s: string): number {
	const dot = s.indexOf(".");
	return dot === -1 ? 0 : s.length - dot - 1;
}

// Exact conversion of a decimal string to a scaled integer, so amounts are
// summed and compared without floating-point error (0.1 + 0.1 + 0.1 must equal
// 0.3, which IEEE-754 gets wrong). Caller guarantees `s` matches DECIMAL and
// fracLen(s) <= scale.
function toScaled(s: string, scale: number): bigint {
	const [intPart, fracPart = ""] = s.split(".");
	const padded = (fracPart + "0".repeat(scale)).slice(0, scale);
	return BigInt(intPart + padded);
}

export function validate(
	r: StrategyRecommendation,
	q: RecommendationRequest,
	s: ChainState,
): Violation[] {
	const violations: Violation[] = [];

	// Budget indexed by lowercased address; amounts kept as decimal strings.
	const budgetByAddr = new Map<string, string>();
	for (const b of q.budget) budgetByAddr.set(b.address.toLowerCase(), b.amount);

	// I3 — strategy count within [1, maxStrategies].
	if (r.strategies.length < 1) {
		violations.push({
			code: "I3",
			message: "recommendation has no strategies",
		});
	} else if (r.strategies.length > q.maxStrategies) {
		violations.push({
			code: "I3",
			message: `${r.strategies.length} strategies exceeds maxStrategies ${q.maxStrategies}`,
		});
	}

	// I4 — chain match. The user-equality half (r.user == q.user) is deferred:
	// `user` is a committer-supplied arg, not part of the recommendation-only
	// payload (F2 §2/§5), so there is nothing to compare here yet.
	if (r.chainId !== s.chainId) {
		violations.push({
			code: "I4",
			message: `recommendation chainId ${r.chainId} != expected ${s.chainId}`,
		});
	}

	// I1 + I2 — walk every (token, amount) pair once. I1 flags tokens outside the
	// budget; I2 accumulates per-token sums for budgeted tokens only (an unknown
	// token is an I1 problem, not an I2 one).
	const unknownSeen = new Set<string>();
	const sumsByAddr = new Map<string, string[]>(); // budgeted addr -> amounts
	for (const st of r.strategies) {
		const n = Math.min(st.tokens.length, st.virtualAmounts.length);
		for (let k = 0; k < n; k++) {
			const addr = String(st.tokens[k]).toLowerCase();
			const amt = st.virtualAmounts[k];
			if (!budgetByAddr.has(addr)) {
				if (!unknownSeen.has(addr)) {
					unknownSeen.add(addr);
					violations.push({
						code: "I1",
						message: `token ${st.tokens[k]} is not in the user's budget`,
					});
				}
				continue;
			}
			if (typeof amt === "string" && DECIMAL.test(amt)) {
				const list = sumsByAddr.get(addr) ?? [];
				list.push(amt);
				sumsByAddr.set(addr, list);
			}
			// A non-decimal amount is an I11 (amount well-formedness) concern,
			// which is out of this slice — the parser already surfaces it.
		}
	}

	for (const [addr, amounts] of sumsByAddr) {
		const cap = budgetByAddr.get(addr)!;
		const scale = Math.max(fracLen(cap), ...amounts.map(fracLen));
		const total = amounts.reduce((acc, a) => acc + toScaled(a, scale), 0n);
		if (total > toScaled(cap, scale)) {
			const budgeted = q.budget.find((b) => b.address.toLowerCase() === addr);
			violations.push({
				code: "I2",
				message: `total virtualAmounts for ${budgeted?.symbol ?? addr} (${amounts.join(" + ")}) exceed budget ${cap}`,
			});
		}
	}

	// I12 — freshness. A snapshot ahead of head is impossible (future); one too
	// far behind head is stale. Both fail.
	const lag = s.maxBlockLag ?? DEFAULT_MAX_BLOCK_LAG;
	if (r.observedBlock > s.headBlock) {
		violations.push({
			code: "I12",
			message: `observedBlock ${r.observedBlock} is ahead of head ${s.headBlock}`,
		});
	} else if (r.observedBlock < s.headBlock - lag) {
		violations.push({
			code: "I12",
			message: `observedBlock ${r.observedBlock} is more than ${lag} blocks behind head ${s.headBlock}`,
		});
	}

	return violations;
}
