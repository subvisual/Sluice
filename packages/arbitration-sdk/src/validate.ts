// Deterministic recommendation validator (F2 §6). It REJECTS; it never mutates
// and never rewrites (F2 §4: "nothing is ever edited. Violations reject and
// re-infer"). A pure function of (recommendation, request, chain state).
//
// This implements every invariant that is in scope for the recommendation path
// AND meaningful on the deployed AquaSwapVMRouter (F1 grammar, now settled — the
// menu in grammar.ts is the complete instruction set of the pinned router):
//
//   Budget & authority (grammar-independent):
//   I1  every token in r is a token the user selected in q.budget
//   I2  per token: Σ virtualAmounts across ALL strategies <= q.budget[token]
//   I3  r.strategies.length in [1, q.maxStrategies]
//   I4  r.chainId == config chain (the r.user == q.user half is committer-
//       supplied, deferred with the commit path — F2 §2/§5)
//
//   Grammar (per strategy, against grammar.ts / the pinned opcode table):
//   I5  slots use ONLY offered instructions — curve ∈ CURVE_OPTIONS (exactly
//       one, structural), fee ∈ WRAPPER_OPTIONS with feeBps ∈ [0, FEE_BPS_ONE),
//       guards ∈ GUARD_OPTIONS. Anything else cannot be compiled for this venue.
//   I7  deadline present, in (now, now + q.maxDeadlineSec]
//   I8  templateId references a known seed template
//   I10 tokens in canonical (strictly ascending address) order, no duplicates
//   I11 each virtualAmount is a decimal string and strictly positive
//
//   Freshness:
//   I12 observedBlock within N blocks of head (stale-snapshot guard)
//
// N/A on this venue — deliberately NOT emitted (the opcodes do not exist here):
//   I6  (partial-fill ⇒ token-invalidation): no LimitSwap / invalidation opcode.
//   I9  (oracle adjuster ⇒ feed configured): no oracle-adjust opcode anywhere.
// Deferred (out of the recommendation-only scope):
//   I13 nonce replay — enforced on-chain in commitRecommendation (F2 §2).
//   I14 byte-for-byte recompile-equality — a ship-path defence; I5 already
//       guarantees every named instruction is dispatchable (compilable) here.
//   I15 whole-balance sizing — parked (F2 §6).

import type {
	RecommendationRequest,
	SlotAssignment,
	StrategyRecommendation,
} from "./recommendation.ts";
import {
	CURVE_OPTIONS,
	WRAPPER_OPTIONS,
	GUARD_OPTIONS,
	TEMPLATES,
} from "./grammar.ts";
import { FEE_BPS_ONE } from "./opcodes.ts";

// One rejection. `code` is the invariant id so a caller (and the trace) can
// see exactly which rule fired; `message` is human-facing.
export type Violation = {
	code: "I1" | "I2" | "I3" | "I4" | "I5" | "I7" | "I8" | "I10" | "I11" | "I12";
	message: string;
};

// The live chain facts the validator needs. Stands in for the "s: ChainState"
// argument in F2 §6. `chainId` is the config chain the recommendation must
// target; `headBlock` is the current indexed head; `now` is the current unix
// time (for the deadline bound); `maxBlockLag` is the I12 staleness policy.
export type ChainState = {
	chainId: number;
	headBlock: number;
	now: number;
	maxBlockLag?: number;
};

// How many blocks behind head an observation may be before it is stale. Base
// blocks are ~2s, so ~50 blocks ≈ 100s — a snapshot older than that was priced
// against a market that has since moved.
export const DEFAULT_MAX_BLOCK_LAG = 50;

const DECIMAL = /^\d+(\.\d+)?$/;
const ZERO = /^0*(\.0*)?$/; // "0", "0.0", ".000" — numerically zero

const CURVES = new Set(CURVE_OPTIONS);
const WRAPPERS = new Set(WRAPPER_OPTIONS);
const GUARDS = new Set(GUARD_OPTIONS);
const TEMPLATE_IDS = new Set(TEMPLATES.map((t) => t.id));

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

// Every message ends by naming the value that would satisfy the rule, whenever
// that value is deterministic. The rejection feedback IS the next prompt
// (compose.ts hands these straight back), and the retry budget is one attempt —
// a model made to re-derive the number it just got wrong usually gets it wrong
// again. Where no deterministic fix exists — which template suits the intent —
// the message states the rule and stops; invented advice is worse than none.

/// The menu for a slot, as a corrective clause. An empty menu is a real answer
/// on this venue (no guard has an encoder yet), and the fix is to drop the slot.
function offered(options: string[], slot: string): string {
	return options.length > 0
		? `use one of: ${options.join(", ")}`
		: `nothing is offered here on this venue — omit the ${slot} slot`;
}

// Grammar checks for one strategy (I5, I7, I8, I10, I11). `at` labels messages.
function validateStrategy(
	st: SlotAssignment,
	q: RecommendationRequest,
	s: ChainState,
	at: string,
	push: (code: Violation["code"], message: string) => void,
): void {
	// I8 — templateId is a known seed shape.
	if (!TEMPLATE_IDS.has(st.templateId)) {
		push(
			"I8",
			`${at}: templateId "${st.templateId}" is not a known template — known ids: ${[...TEMPLATE_IDS].join(", ")}`,
		);
	}

	// I5 — every named instruction is one this venue actually offers.
	const curve = st.slots?.curve?.instruction;
	if (!curve || !CURVES.has(curve)) {
		push(
			"I5",
			`${at}: curve ${JSON.stringify(curve)} is not a curve on this venue — ${offered(CURVE_OPTIONS, "curve")}`,
		);
	}
	const fee = st.slots?.fee;
	if (fee) {
		if (!WRAPPERS.has(fee.instruction)) {
			push(
				"I5",
				`${at}: fee "${fee.instruction}" is not an offered wrapper — ${offered(WRAPPER_OPTIONS, "fee")}`,
			);
		} else {
			const feeBps = fee.params?.feeBps;
			if (feeBps !== undefined) {
				const n = Number(feeBps);
				if (!Number.isInteger(n) || n < 0 || n >= FEE_BPS_ONE) {
					push(
						"I5",
						`${at}: feeBps ${JSON.stringify(feeBps)} must be an integer in [0, ${FEE_BPS_ONE}) — it is out of ${FEE_BPS_ONE}, not 10000, so 0.3% is ${(FEE_BPS_ONE / 1000) * 3}`,
					);
				}
			}
		}
	}
	for (const g of st.slots?.guards ?? []) {
		if (!GUARDS.has(g?.instruction)) {
			push(
				"I5",
				`${at}: guard "${g?.instruction}" is not an offered guard — ${offered(GUARD_OPTIONS, "guards")}`,
			);
		}
	}

	// I7 — deadline present and within (now, now + maxDeadlineSec].
	const dl = st.slots?.deadline?.deadline;
	const deadlineMax = s.now + q.maxDeadlineSec;
	if (typeof dl !== "number") {
		push(
			"I7",
			`${at}: deadline is missing — set slots.deadline.deadline to ${deadlineMax}`,
		);
	} else if (!(dl > s.now && dl <= deadlineMax)) {
		push(
			"I7",
			`${at}: deadline ${dl} is not within (now ${s.now}, now + maxDeadlineSec ${deadlineMax}] — use ${deadlineMax}`,
		);
	}

	// I10 — canonical token order: strictly ascending by address (also rejects
	// duplicates). Catches the token0/token1 inversion that silently doubles or
	// halves a position. Addresses are fixed-width 0x-hex, so lexicographic order
	// on the lowercased string is numeric order.
	const addrs = st.tokens.map((t) => String(t).toLowerCase());
	for (let k = 1; k < addrs.length; k++) {
		if (!(addrs[k - 1] < addrs[k])) {
			// The sorted order is the fix — and the amounts move with their tokens,
			// which is the half a model drops when it reorders on its own.
			const canonical = [...st.tokens].sort((x, y) =>
				String(x).toLowerCase() < String(y).toLowerCase() ? -1 : 1,
			);
			push(
				"I10",
				`${at}: tokens are not in canonical ascending order (${st.tokens[k - 1]} then ${st.tokens[k]}) — use ${JSON.stringify(canonical)}, moving each virtualAmount with its token`,
			);
			break;
		}
	}

	// I11 — each amount is a decimal string and strictly positive. (The uint256
	// ceiling is a base-unit property enforced when the amount is scaled at
	// compile time; here we reject the two errors a model actually makes:
	// non-numeric, and zero — a zero leg commits or computes nothing.)
	st.virtualAmounts.forEach((a, k) => {
		if (typeof a !== "string" || !DECIMAL.test(a)) {
			push(
				"I11",
				`${at}: virtualAmount ${JSON.stringify(a)} is not a decimal string — quote it as a positive decimal in human units, e.g. "0.25"`,
			);
		} else if (ZERO.test(a)) {
			push(
				"I11",
				`${at}: virtualAmount[${k}] is zero — every leg must commit a positive amount, or drop the token from this strategy`,
			);
		}
	});
}

export function validate(
	r: StrategyRecommendation,
	q: RecommendationRequest,
	s: ChainState,
): Violation[] {
	const violations: Violation[] = [];
	const push = (code: Violation["code"], message: string) =>
		violations.push({ code, message });

	// Budget indexed by lowercased address; amounts kept as decimal strings.
	const budgetByAddr = new Map<string, string>();
	for (const b of q.budget) budgetByAddr.set(b.address.toLowerCase(), b.amount);
	// The allowed-token list, as a corrective clause for I1.
	const allowed = q.budget.map((b) => `${b.symbol} (${b.address})`).join(", ");

	// I3 — strategy count within [1, maxStrategies].
	if (r.strategies.length < 1) {
		push(
			"I3",
			`recommendation has no strategies — return between 1 and ${q.maxStrategies}`,
		);
	} else if (r.strategies.length > q.maxStrategies) {
		push(
			"I3",
			`${r.strategies.length} strategies exceeds maxStrategies ${q.maxStrategies} — return at most ${q.maxStrategies}`,
		);
	}

	// I4 — chain match. The user-equality half (r.user == q.user) is deferred:
	// `user` is a committer-supplied arg, not part of the recommendation-only
	// payload (F2 §2/§5), so there is nothing to compare here yet.
	if (r.chainId !== s.chainId) {
		push(
			"I4",
			`recommendation chainId ${r.chainId} != expected ${s.chainId} — set "chainId": ${s.chainId}`,
		);
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
					push(
						"I1",
						`token ${st.tokens[k]} is not in the user's budget — the only tokens you may commit are: ${allowed}`,
					);
				}
				continue;
			}
			if (typeof amt === "string" && DECIMAL.test(amt)) {
				const list = sumsByAddr.get(addr) ?? [];
				list.push(amt);
				sumsByAddr.set(addr, list);
			}
		}
	}

	for (const [addr, amounts] of sumsByAddr) {
		const cap = budgetByAddr.get(addr)!;
		const scale = Math.max(fracLen(cap), ...amounts.map(fracLen));
		const total = amounts.reduce((acc, a) => acc + toScaled(a, scale), 0n);
		if (total > toScaled(cap, scale)) {
			const budgeted = q.budget.find((b) => b.address.toLowerCase() === addr);
			push(
				"I2",
				`total virtualAmounts for ${budgeted?.symbol ?? addr} (${amounts.join(" + ")}) exceed budget ${cap} — divide the ${cap} between your strategies rather than giving each the full amount; the total across all of them must be at most ${cap}`,
			);
		}
	}

	// Grammar invariants, per strategy (I5, I7, I8, I10, I11).
	r.strategies.forEach((st, i) =>
		validateStrategy(st, q, s, `strategies[${i}]`, push),
	);

	// I12 — freshness. A snapshot ahead of head is impossible (future); one too
	// far behind head is stale. Both fail.
	const lag = s.maxBlockLag ?? DEFAULT_MAX_BLOCK_LAG;
	if (r.observedBlock > s.headBlock) {
		push(
			"I12",
			`observedBlock ${r.observedBlock} is ahead of head ${s.headBlock} — copy observedBlock from the prompt's snapshot, do not compute it; set "observedBlock": ${s.headBlock}`,
		);
	} else if (r.observedBlock < s.headBlock - lag) {
		push(
			"I12",
			`observedBlock ${r.observedBlock} is more than ${lag} blocks behind head ${s.headBlock} — set "observedBlock": ${s.headBlock}`,
		);
	}

	return violations;
}
