// Band tiers: one pair, three widths (issue #26).
//
// The full version ranks different PAIRS by historical yield, which needs
// market data we do not have yet. But on a single pair the risk axis already
// exists: band width. A tighter band quotes deeper — more fill volume for the
// same commitment — and is exhausted by a smaller price move; a wider band is
// safer and earns less. `banded` is the one shape with sustained fills on real
// Base.
//
// So three tiers ship with zero new data: same pair, same budget, three widths,
// computed from realised volatility and handed to the model as integers to echo.
//
// Labels describe MECHANICS ("exhausted by a ±X% move"), never yield: we have
// no fee-APR source yet, and a projected return we cannot back is a claim this
// project refuses to make. Rating the risk of the resulting recommendation is
// Gate 2's job (deferred) — this only sizes bands.

import type { RiskAppetite } from "./appetite.ts";
import { FEE_BPS_ONE } from "./opcodes.ts";

export type BandTier = {
	tier: "wide" | "mid" | "tight";
	/** Out of FEE_BPS_ONE (1e9), integer — the value the model echoes. */
	bandBps: number;
	/** Derived FROM bandBps, so the label can never disagree with the number. */
	movePct: string;
};

const YEAR_SEC = 365 * 24 * 60 * 60;

// CALIBRATION — a real decision, stated because the field name alone does not
// settle it. `realizedVol7dPct` is read as an ANNUALISED percentage measured
// over a 7-day sample (the standard convention for quoted volatility), not as
// "the price moved 58% during that week". 58 is the canonical annualised figure
// for ETH, and the other reading produces ±87%–±99% bands — full-range in all
// but name. They differ by ~3.5x, so confirm this when a real volatility source
// lands (the field may want renaming then); the multipliers below are the knob.

// Multiples of the horizon-scaled volatility, per tier. Appetite shifts the SET,
// never the count: a risk-inclined user gets three tighter choices, not more.
const MULTIPLIERS: Record<RiskAppetite, [number, number, number]> = {
	conservative: [3, 1.5, 0.75],
	neutral: [2, 1, 0.5],
	aggressive: [1, 0.5, 0.25],
};

// A vol floor so a zero/absent volatility still produces three distinct, usable
// bands rather than three zeros, and a ceiling below 100% because a band at or
// past FEE_BPS_ONE is not encodable.
const MIN_VOL_PCT = 0.1;
const MAX_BAND_PCT = 99;

const pctToBps = (pct: number) => Math.round((pct / 100) * FEE_BPS_ONE);
const bpsToPct = (bps: number) => ((bps / FEE_BPS_ONE) * 100).toFixed(2);

/**
 * Three band widths for one pair, wide → tight.
 *
 * Volatility is quoted annualised and a strategy lives for `horizonSec`, so it
 * is scaled by sqrt(time) before use: a band that fits a year is too wide for a
 * week. The result is clamped into the encodable range and forced strictly
 * decreasing — under extreme volatility all three would otherwise pin to the
 * ceiling, and three identical "tiers" would be a lie the UI would render.
 */
export function bandTiers(
	realizedVol7dPct: number,
	horizonSec: number,
	appetite: RiskAppetite,
): BandTier[] {
	const vol = Number.isFinite(realizedVol7dPct) ? Math.max(realizedVol7dPct, 0) : 0;
	const horizon = Math.max(horizonSec, 1);
	const scaled = Math.max(vol * Math.sqrt(horizon / YEAR_SEC), MIN_VOL_PCT);

	const names: BandTier["tier"][] = ["wide", "mid", "tight"];
	const bps = MULTIPLIERS[appetite].map((m) =>
		Math.min(Math.max(pctToBps(Math.min(scaled * m, MAX_BAND_PCT)), 1), FEE_BPS_ONE - 1),
	);
	// Strictly decreasing, wide → tight. Only bites at the clamp ceiling.
	for (let i = 1; i < bps.length; i++) {
		bps[i] = Math.min(bps[i], bps[i - 1] - 1);
	}

	return names.map((tier, i) => ({
		tier,
		bandBps: bps[i],
		movePct: bpsToPct(bps[i]),
	}));
}

export function tiersPromptBlock(
	tiers: BandTier[],
	opts: { stubVol: boolean; maxStrategies: number; hasPairing: boolean },
): string {
	const rows = tiers.map(
		(t) =>
			`  ${t.tier.padEnd(5)} bandBps ${String(t.bandBps).padStart(10)} — inventory is exhausted by a ±${t.movePct}% move`,
	);
	const source = opts.stubVol
		? "the pair's realised volatility (STUB pair data — not live)"
		: "the pair's realised volatility";

	return [
		`SUGGESTED BAND TIERS — derived from ${source}, scaled to this request's`,
		"deadline and shifted for the stated risk appetite. Integers; echo them:",
		...rows,
		"A tighter band quotes DEEPER for the same commitment (more fill volume) and is",
		"exhausted by a smaller price move. That is the whole trade-off — there is no",
		"yield estimate here, so do not invent one.",
		"",
		`TASK — because maxStrategies is ${opts.maxStrategies}: unless the user asked for one`,
		"specific shape, return exactly three strategies on this pair, one per tier above,",
		"using the `banded` or `banded-fee` template with that tier's bandBps.",
		// Never point at a block that was not rendered: with no pairing plan there
		// is no per-strategy line to copy.
		opts.hasPairing
			? "Take each strategy's amounts from REFERENCE PAIRING's per-strategy line — do not divide anything yourself."
			: "DIVIDE the budget between the three — the per-token total across all of them must stay within the ceiling, so do not give each strategy the full amount.",
	].join("\n");
}
