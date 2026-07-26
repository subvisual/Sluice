// The SwapVM strategy grammar the model fills in — for the DEPLOYED router.
//
// Every instruction named here is looked up through opcodes.ts, which loads the
// pinned table in config/opcodes.8453.json. An instruction that is not
// dispatchable cannot appear in this file without throwing on import, so the
// menu we show the model cannot drift from the venue we ship to.
//
// The menu is narrower still: an instruction is offered ONLY if swapvm.ts can
// encode it AND a fixture has shipped and filled it on the fork. "The venue
// dispatches it" is not enough — offering the model something our own compiler
// cannot emit is the same bug as offering something the venue cannot run,
// one layer down. grammar.test.ts compiles every template to enforce this.
//
// THE REAL SHAPE IS A NEST, NOT A LIST
//
// `_flatFeeAmountInXD` (and `_decayXD`) call `ctx.runLoop()` in their own
// bodies: they execute everything after them as an inner loop, then
// post-process. A strategy is therefore fee(curve), emitted flat. Ordering is
// enforced by the VM rather than by us — the wrappers open with
// `require(amountIn == 0 || amountOut == 0)` and every curve has a recompute
// guard, so a fee after the curve reverts and two curves revert. Our compiler
// owns the order; the chain agrees with it.
//
// (The six-slot grammar this file used to describe — balance setup, swap
// logic, oracle adjust, invalidation — could not be built against this router
// at all; see the PR #15 discussion. Do not reintroduce it.)

import { OP, op, FEE_BPS_ONE } from "./opcodes.ts";

export type InstructionSpec = {
	name: string; // key in the pinned opcode table
	opcode: number;
	summary: string;
	params?: string;
};

/// Required on every strategy. Not a model choice beyond the timestamp.
export const DEADLINE: InstructionSpec = {
	name: "DEADLINE",
	opcode: op("DEADLINE"),
	summary: "Expiry. Always present — it is what unwinds an unattended position.",
	params: "deadline: unix seconds",
};

/// Optional wrappers. MUST precede the curve or the VM reverts.
export const WRAPPERS: InstructionSpec[] = [
	{
		name: "FLAT_FEE_AMOUNT_IN_XD",
		opcode: op("FLAT_FEE_AMOUNT_IN_XD"),
		summary:
			"Maker fee charged on the input side. Pure arithmetic — no token movement, " +
			"so unlike the protocol-fee variants it cannot make quote() and swap() disagree.",
		params: `feeBps: integer in [1, ${FEE_BPS_ONE}) where ${FEE_BPS_ONE} = 100%. Never 0 — a fee that charges nothing still ships this instruction; the no-fee templates exist for that.`,
	},
];

/// Optional band. MUST precede the fee and the curve, and requires a curve
/// after it — it post-processes the computed amounts, so a program ending here
/// reverts. The model chooses bandBps ONLY; the compiler derives the on-chain
/// deltas from bandBps and the virtual amounts, the same way it owns bytes and
/// ordering everywhere else. Raw deltas are never a model output.
export const BAND: InstructionSpec = {
	name: "XYC_CONCENTRATE_GROW_LIQUIDITY_2D",
	opcode: op("XYC_CONCENTRATE_GROW_LIQUIDITY_2D"),
	summary:
		"Concentrates the shipped liquidity into a geometric band around the shipped " +
		"price: the quoted price stays the ratio of the shipped amounts, the effective " +
		"depth is multiplied, and the real inventory drains exactly at the band edges. " +
		"Tighter band = deeper quotes = better taker pricing, but the position is " +
		"exhausted by a smaller price move.",
	params:
		`bandBps: integer in (0, ${FEE_BPS_ONE}), out of ${FEE_BPS_ONE} like feeBps — ` +
		"the price may move by this fraction above the shipped ratio (and the " +
		"reciprocal below it) before the band's inventory is gone. 1% is 10000000.",
};

/// Exactly one, and it goes last. Terminal: it computes the amounts.
export const CURVES: InstructionSpec[] = [
	{
		name: "XYC_SWAP_XD",
		opcode: op("XYC_SWAP_XD"),
		summary:
			"Constant product over the shipped virtual balances, for whichever pair the " +
			"taker names. Takes NO arguments: the price is the ratio of the shipped " +
			"amounts and the depth is their absolute size.",
	},
];

/// Dispatchable on the router but deliberately not offered. Each entry records
/// something that cost real time to learn; everything else the router
/// dispatches (jumps, progressive/output-side fees, the supply-share gate) is
/// simply unused — no entry needed until someone reaches for one.
export const OMITTED: Record<string, string> = {
	XYC_CONCENTRATE_GROW_LIQUIDITY_XD:
		"N-token variant of the band. The 2D variant's delta arithmetic is settled " +
		"(bandDeltas in swapvm.ts, mirrored from the deployed computeDeltas and " +
		"fill-tested), but XD adds a variable-width token list no template needs — " +
		"every strategy is one pair. Stays out until an intent needs three tokens.",
	DECAY_XD:
		"Reads state in quote mode without writing it, so quote() can succeed where " +
		"swap() reverts. Stays out until that divergence is measured.",
	ONLY_TAKER_TOKEN_BALANCE_NON_ZERO:
		"No encoder in swapvm.ts yet. Offering the model an instruction our own " +
		"compiler cannot emit is the grammar-drift bug one layer down.",
	ONLY_TAKER_TOKEN_BALANCE_GTE: "As above — no encoder yet, and no template or intent needs it.",
};

/// SALT is emitted by the compiler on every strategy and is NOT a model choice.
/// It is a genuine no-op whose only job is to vary the bytes: a docked hash is
/// burned permanently and amounts are not in the preimage, so re-entering a
/// position needs new bytes under a new salt. F1 §2.
export const COMPILER_EMITTED = ["SALT"] as const;

export const CURVE_OPTIONS = CURVES.map((i) => i.name);
export const WRAPPER_OPTIONS = WRAPPERS.map((i) => i.name);
export const BAND_OPTIONS = [BAND.name];
/// Empty until a taker-gate encoder exists — see OMITTED. Kept because
/// recommendation.ts notes any guard the model invents against this list.
export const GUARD_OPTIONS: string[] = [];

/// Enforced deterministically by the validator, and stated to the model so it
/// complies on the first attempt more often — every retry is a round trip a
/// user is waiting on.
export const COMPAT_RULES: string[] = [
	"Exactly one curve instruction, and it is LAST. It is terminal: the VM reverts if amounts were already computed.",
	"The fee comes BEFORE the curve. Placed after, the VM reverts.",
	"The band comes BEFORE the fee and the curve, and requires a curve after it. You choose bandBps only — the compiler derives the concentration deltas from the virtual amounts; never emit deltas.",
	"A tighter band quotes deeper but exhausts on a smaller price move: the shipped amounts are drained exactly when the price reaches a band edge, and a draw past the edge reverts for the taker.",
	"DEADLINE is always present, and within the request's maxDeadlineSec.",
	'Amounts are in WHOLE TOKEN UNITS, exactly as the BUDGET states them: "0.5" WETH, "1500" USDC. NEVER base units — no 1e18, no 1e6, no "1000000000000000000". The compiler scales by each token\'s decimals; emitting scaled amounts overshoots the budget by orders of magnitude and is rejected.',
	"Amounts stay within the user's stated budget, PER TOKEN, summed across every strategy in the recommendation. Strategies ship TOGETHER — they are legs of one position, not alternatives to choose between — so returning N of them means SPLITTING the budget across them, never repeating the full budget in each. Never a token the user did not select.",
	'The virtual amounts set both the price (their ratio) and the depth (their size). For a pair that should trade near parity, ship equal nominal VALUE on each side: against a 3000 USD/ETH mid, "0.5" WETH pairs with "1500" USDC.',
	`feeBps is out of ${FEE_BPS_ONE}, not 10000: 0.3% is ${(FEE_BPS_ONE / 1000) * 3}. Never 0: to charge no fee, pick full-range or banded and omit the fee slot entirely.`,
];

export type Template = {
	id: string;
	label: string;
	describesIntent: string;
	curve: string;
	wrappers: string[];
	shape: string;
};

/// Known-good seed shapes. Membership requires a fixture that has shipped and
/// filled on the fork — grammar.test.ts compiles each one, and fixtures.ts
/// carries each one through the G3 test.
export const TEMPLATES: Template[] = [
	{
		id: "full-range",
		label: "full-range · market-make the whole curve",
		describesIntent: "make a market on a pair I hold both sides of, with no view on a price range",
		curve: "XYC_SWAP_XD",
		wrappers: [],
		shape: "constant product; the shipped amounts set the price and the depth. Proven to fill on the fork.",
	},
	{
		id: "full-range-fee",
		label: "full-range + maker fee",
		describesIntent: "same, but earn a spread on every fill",
		curve: "XYC_SWAP_XD",
		wrappers: ["FLAT_FEE_AMOUNT_IN_XD"],
		shape: "constant product with a flat input-side fee; higher edge per fill, fewer fills.",
	},
	{
		id: "banded",
		label: "banded · concentrate around the current price",
		describesIntent:
			"make a market on a pair I expect to stay near its current price — quote deep, accept that a move past the band exhausts me",
		curve: "XYC_SWAP_XD",
		wrappers: ["XYC_CONCENTRATE_GROW_LIQUIDITY_2D"],
		shape:
			"constant product concentrated into a band around the shipped price; same commitment, " +
			"multiplied depth, inventory drains at the band edges. The one shape with sustained " +
			"fills on real Base. Proven to fill on the fork.",
	},
	{
		id: "banded-fee",
		label: "banded + maker fee",
		describesIntent: "same, but earn a spread on every fill inside the band",
		curve: "XYC_SWAP_XD",
		wrappers: ["XYC_CONCENTRATE_GROW_LIQUIDITY_2D", "FLAT_FEE_AMOUNT_IN_XD"],
		shape: "the banded shape with a flat input-side fee taken on every fill inside the band.",
	},
];

export function grammarPromptBlock(): string {
	const render = (list: InstructionSpec[]) =>
		list.map((i) => `    ${i.name} — ${i.summary}${i.params ? `\n        params: ${i.params}` : ""}`).join("\n");

	return [
		"INSTRUCTION SET (this is the COMPLETE menu — nothing else exists on this venue):",
		"  required on every strategy:",
		render([DEADLINE]),
		"  optional band (MUST come before the fee and the curve):",
		render([BAND]),
		"  optional wrappers (MUST come before the curve):",
		render(WRAPPERS),
		"  curve (EXACTLY ONE, and it goes LAST):",
		render(CURVES),
		"",
		"You do NOT choose a salt — the compiler emits one on every strategy.",
		"",
		"RULES:",
		...COMPAT_RULES.map((r) => `  - ${r}`),
		"",
		"SEED TEMPLATES (pick one and parameterise it):",
		...TEMPLATES.map(
			(t) =>
				`  ${t.id} (${t.label}) — intent: "${t.describesIntent}"\n` +
				`      curve=${t.curve}${t.wrappers.length ? `, wrappers=${t.wrappers.join(", ")}` : ""}; ${t.shape}`,
		),
	].join("\n");
}

/// Every name this grammar mentions must be dispatchable on the pinned venue.
export function unknownInstructions(): string[] {
	return [
		DEADLINE.name,
		BAND.name,
		...WRAPPERS.map((i) => i.name),
		...CURVES.map((i) => i.name),
		...COMPILER_EMITTED,
		...Object.keys(OMITTED),
	].filter((name) => OP[name] === undefined);
}
