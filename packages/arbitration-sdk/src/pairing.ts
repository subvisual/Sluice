// Value-matched pairing arithmetic, computed FOR the model (T0.2 / issue #25).
//
// The shipped virtualAmounts set both the price (their ratio) and the depth
// (their size) — grammar.ts says exactly that, and then the prompt leaves the
// model to divide a budget by a mid price across two different decimal scales.
// That is the arithmetic a 7B model quietly gets wrong, and a wrong ratio is
// not cosmetic: it ships a strategy priced off-mid, which is free money for the
// first taker. Nothing in the validator catches it today (a price-vs-mid
// invariant is Tier 2 work), so the cheapest fix is to not ask.
//
// Everything here is exact fixed-point on decimal strings. A float would shift
// the last digits of a number that ends up inside a signed artifact.

import type { MarketContext } from "./context.ts";
import type { RecommendationRequest, TokenBudget } from "./recommendation.ts";

// Internal working precision, and the precision we print at. Six fractional
// digits is exact for USDC (6 decimals) and a fine granularity for a WETH
// CEILING — and it keeps the model from emitting more digits than a token has,
// which the app otherwise has to truncate on the way back in.
const WORK_ONE = 10n ** 18n;
const DISPLAY_FRAC = 6;
const DISPLAY_ONE = 10n ** BigInt(DISPLAY_FRAC);

const DECIMAL = /^\d+(\.\d+)?$/;

/// Decimal string -> integer scaled by 1e18. Null if it is not a plain decimal.
function parseDec(s: string): bigint | null {
	if (!DECIMAL.test(s)) return null;
	const [whole, frac = ""] = s.split(".");
	return BigInt(whole + (frac + "0".repeat(18)).slice(0, 18));
}

/// A JS number as a decimal string. Rejects the exponential forms (1e-7, 1e21)
/// rather than parsing them — midPrice is data we display and divide by, and a
/// silently mangled price is worse than no pairing block at all.
function numberToDec(n: number): string | null {
	if (!Number.isFinite(n) || n <= 0) return null;
	const s = String(n);
	return DECIMAL.test(s) ? s : null;
}

/// Scaled integer -> decimal string, TRUNCATED to DISPLAY_FRAC digits and with
/// trailing zeros trimmed. Truncation (never rounding) keeps a ceiling a
/// ceiling: dropping digits can only understate what the user offered.
function formatDec(v: bigint): string {
	const scaled = v / (WORK_ONE / DISPLAY_ONE);
	const whole = scaled / DISPLAY_ONE;
	const frac = (scaled % DISPLAY_ONE).toString().padStart(DISPLAY_FRAC, "0").replace(/0+$/, "");
	return frac === "" ? whole.toString() : `${whole}.${frac}`;
}

const mul = (a: bigint, b: bigint) => (a * b) / WORK_ONE;
const div = (a: bigint, b: bigint) => (a * WORK_ONE) / b;

export type PairingLeg = {
	symbol: string;
	address: string;
	/** The ceiling the user set, verbatim. */
	budget: string;
	/** How much of it a mid-consistent pair can actually use, in total. */
	total: string;
	/** That total divided by the number of strategies asked for. */
	perStrategy: string;
};

export type Pairing = {
	/** token1 per token0, as a decimal string. */
	mid: string;
	/** Both legs, in canonical ascending address order (matches I10). */
	legs: [PairingLeg, PairingLeg];
	/** The symbol whose ceiling binds the pair — the other is left partly unused. */
	binding: string;
	strategies: number;
};

/**
 * The largest mid-consistent pair that fits BOTH ceilings, and its per-strategy
 * share.
 *
 * Whichever ceiling binds decides the size: 2 WETH against 3000 USDC at a mid
 * of 3450 cannot use the whole 2 WETH, because 2 WETH is 6900 USDC of value
 * and the user only offered 3000. Committing both ceilings in full would ship
 * a price that is not the mid — which is exactly the mistake this exists to
 * prevent.
 *
 * Returns null when there is nothing to compute: a budget that does not hold
 * both sides of the context's pair, or an unusable mid. The prompt then simply
 * omits the block rather than showing invented numbers.
 */
export function pairingPlan(
	ctx: MarketContext,
	req: RecommendationRequest,
	strategies: number,
): Pairing | null {
	const [sym0, sym1] = ctx.pair.pair.split("/").map((s) => s.trim());
	if (!sym0 || !sym1) return null;

	const find = (symbol: string): TokenBudget | undefined =>
		req.budget.find((b) => b.symbol.toUpperCase() === symbol.toUpperCase());
	const b0 = find(sym0);
	const b1 = find(sym1);
	if (!b0 || !b1) return null;

	const midStr = numberToDec(ctx.pair.midPrice);
	if (!midStr) return null;
	const mid = parseDec(midStr);
	const cap0 = parseDec(b0.amount);
	const cap1 = parseDec(b1.amount);
	if (!mid || !cap0 || !cap1 || mid === 0n || cap0 === 0n || cap1 === 0n) return null;
	if (strategies < 1) return null;

	// Value-match, then let the binding side decide the size.
	const needed1 = mul(cap0, mid); // token1 required to pair ALL of token0
	const token0Binds = needed1 <= cap1;
	const total0 = token0Binds ? cap0 : div(cap1, mid);
	const total1 = token0Binds ? needed1 : cap1;

	// Truncating each share DOWN means N shares sum to at most the total, so the
	// per-token sum across strategies stays inside the budget (I2) by
	// construction rather than by the model's arithmetic.
	const n = BigInt(strategies);
	const leg = (b: TokenBudget, total: bigint): PairingLeg => ({
		symbol: b.symbol,
		address: b.address,
		budget: b.amount,
		total: formatDec(total),
		perStrategy: formatDec(total / n),
	});

	const legs: [PairingLeg, PairingLeg] = [leg(b0, total0), leg(b1, total1)];
	legs.sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));

	return {
		mid: midStr,
		legs,
		binding: token0Binds ? b0.symbol : b1.symbol,
		strategies,
	};
}

export function pairingPromptBlock(p: Pairing | null): string {
	if (!p) return "";
	const [a, b] = p.legs;
	const per = p.strategies > 1 ? ` | per strategy: ${a.perStrategy} + ${b.perStrategy}` : "";
	return [
		"REFERENCE PAIRING — computed for you. ECHO these numbers; do NOT do your own arithmetic:",
		`  at mid ${p.mid}, the largest pair fitting both ceilings is ${a.total} ${a.symbol} + ${b.total} ${b.symbol}${per}`,
		`  (${p.binding} is the binding ceiling; the other side is deliberately not fully used)`,
		"  The RATIO of a strategy's virtualAmounts IS its shipped price. Keep that ratio,",
		"  unless the user's own words ask for a price away from the mid — then say so by",
		"  changing the ratio deliberately, never by accident.",
	].join("\n");
}
