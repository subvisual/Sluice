// The SwapVM strategy grammar the model fills in — for the DEPLOYED router.
//
// Every instruction named here is looked up through opcodes.ts, which loads the
// pinned table in config/opcodes.8453.json. An instruction that is not
// dispatchable cannot appear in this file without throwing on import, so the
// menu we show the model cannot drift from the venue we ship to. grammar.test.ts
// asserts that property.
//
// WHAT CHANGED, AND WHY IT MATTERED
//
// The previous version of this file described a six-slot grammar taken from
// F1 §5 — balance setup, fees, swap logic, oracle adjust, invalidation,
// deadline — and it was wrong in ways that made it unusable rather than merely
// imprecise. Against the deployed AquaSwapVMRouter v1.0.0:
//
//   • `_limitSwap1D` / `_limitSwapOnlyFull1D` have NO OPCODE. There is no
//     partial-vs-all-or-nothing choice to make, so the entire "partial fill
//     requires token invalidation" rule is moot.
//   • The three invalidators have NO OPCODE. Slot 5, marked required, could
//     not be filled at all.
//   • `_oraclePriceAdjuster1D` has no opcode on ANY router — the file exists in
//     the 1inch source but is not in the opcode enum and is dispatched nowhere.
//   • Balance setup is not an instruction. In Aqua mode balances come from
//     `safeBalances`, i.e. from what `ship()` was called with. Slot 1 does not
//     exist here; `_staticBalancesXD` / `_dynamicBalancesXD` belong to the
//     signature-based mode and are not compiled into this router.
//
// So a model following the old menu produced well-formed JSON describing a
// strategy that could never be built.
//
// THE REAL SHAPE IS A NEST, NOT A LIST
//
// `_flatFeeAmountInXD` and `_decayXD` call `ctx.runLoop()` in their own bodies:
// they execute everything after them as an inner loop and then post-process.
// A strategy is therefore
//
//     fee( decay( curve ) )
//
// emitted as a flat byte sequence. Ordering is enforced by the VM rather than by
// us — both wrappers open with `require(amountIn == 0 || amountOut == 0)` and
// every curve opens with a recompute guard, so a fee after the curve reverts and
// two curves revert. Our builder owns the order; the chain agrees with it.

import { OP, op, FEE_BPS_ONE } from "./opcodes.ts";

/// Where an instruction sits in the program.
///   guard   — prologue, pure/view, may appear before the wrappers
///   wrapper — recursive; MUST precede the curve or the VM reverts
///   curve   — terminal, computes the amounts. Exactly one.
export type Role = "guard" | "wrapper" | "curve";

export type InstructionSpec = {
	name: string; // key in the pinned opcode table
	opcode: number;
	role: Role;
	summary: string;
	params?: string;
};

/// The instructions the composer may choose. This is a SUBSET of what the router
/// dispatches, and deliberately so — see OMITTED below.
export const INSTRUCTIONS: InstructionSpec[] = [
	{
		name: "DEADLINE",
		opcode: op("DEADLINE"),
		role: "guard",
		summary: "Expiry. Always present — it is what unwinds an unattended position.",
		params: "deadline: unix seconds (5 bytes)",
	},
	{
		name: "ONLY_TAKER_TOKEN_BALANCE_NON_ZERO",
		opcode: op("ONLY_TAKER_TOKEN_BALANCE_NON_ZERO"),
		role: "guard",
		summary: "Only takers holding any of a given token may fill.",
		params: "token: address",
	},
	{
		name: "ONLY_TAKER_TOKEN_BALANCE_GTE",
		opcode: op("ONLY_TAKER_TOKEN_BALANCE_GTE"),
		role: "guard",
		summary: "Only takers holding at least minAmount of a token may fill.",
		params: "token: address, minAmount: uint256",
	},
	{
		name: "FLAT_FEE_AMOUNT_IN_XD",
		opcode: op("FLAT_FEE_AMOUNT_IN_XD"),
		role: "wrapper",
		summary:
			"Maker fee charged on the input side. Pure arithmetic — no token movement, " +
			"so unlike the protocol-fee variants it cannot make quote() and swap() disagree.",
		params: `feeBps: integer in [0, ${FEE_BPS_ONE}) where ${FEE_BPS_ONE} = 100%`,
	},
	{
		name: "XYC_SWAP_XD",
		opcode: op("XYC_SWAP_XD"),
		role: "curve",
		summary:
			"Constant product over the shipped virtual balances, for whichever pair the " +
			"taker names. Takes NO arguments: the price is the ratio of the shipped " +
			"amounts and the depth is their absolute size.",
	},
];

/// Deliberately NOT offered to the model, though the router dispatches them.
/// Recorded so nobody re-adds one without reading why it was left out.
export const OMITTED: Record<string, string> = {
	XYC_CONCENTRATE_GROW_LIQUIDITY_2D:
		"Available, but parameterised by VIRTUAL BALANCE DELTAS on the deployed router, " +
		"not the sqrtPriceMin/sqrtPriceMax bounds that 1inch master uses. Until the " +
		"delta arithmetic is settled and fill-tested, offering it would put an " +
		"unverified curve behind a user's signature.",
	XYC_CONCENTRATE_GROW_LIQUIDITY_XD:
		"Same delta parameterisation as the 2D variant, plus an N-token argument list. Same reason: unverified.",
	DECAY_XD:
		"Works, but reads state in quote mode without writing it, so quote() can " +
		"succeed where swap() reverts. Our driver records both, so this stays out " +
		"until that divergence is measured.",
	FLAT_FEE_AMOUNT_OUT_XD: "Output-side fee. No use case yet; adds a second fee axis to validate.",
	PROGRESSIVE_FEE_IN_XD: "Size-dependent fee. Interesting, but unmeasured.",
	PROGRESSIVE_FEE_OUT_XD: "Size-dependent fee on the output side. Same reason as the input-side variant.",
	PROTOCOL_FEE_AMOUNT_OUT_XD: "Moves real tokens mid-program and needs maker allowance; quote/swap divergence.",
	AQUA_PROTOCOL_FEE_AMOUNT_OUT_XD: "Pulls from the maker's Aqua balance mid-program; same divergence risk as the plain variant.",
	JUMP: "Control flow. Needed only for branching templates; the compiler owns jump targets, never the model.",
	JUMP_IF_TOKEN_IN: "Direction asymmetry within a pair. Needs a branching template and compiler-owned jump targets.",
	JUMP_IF_TOKEN_OUT: "As JUMP_IF_TOKEN_IN — the other half of a direction branch.",
	ONLY_TAKER_TOKEN_SUPPLY_SHARE_GTE: "Supply-share gate. Works, but no intent needs it yet.",
};

/// SALT is emitted by the compiler on every strategy and is NOT a model choice.
/// It is a genuine no-op whose only job is to vary the bytes: a docked hash is
/// burned permanently and amounts are not in the preimage, so re-entering a
/// position needs new bytes under a new salt. F1 §2.
export const COMPILER_EMITTED = ["SALT"] as const;

export const CURVE_OPTIONS = INSTRUCTIONS.filter((i) => i.role === "curve").map((i) => i.name);
export const WRAPPER_OPTIONS = INSTRUCTIONS.filter((i) => i.role === "wrapper").map((i) => i.name);
export const GUARD_OPTIONS = INSTRUCTIONS.filter((i) => i.role === "guard").map((i) => i.name);

/// Enforced deterministically by the validator, and stated to the model so it
/// complies on the first attempt more often — every retry is a round trip a user
/// is waiting on.
export const COMPAT_RULES: string[] = [
	"Exactly one curve instruction, and it is LAST. It is terminal: the VM reverts if amounts were already computed.",
	"Fees and any balance-tuning instruction come BEFORE the curve. Placed after, the VM reverts.",
	"DEADLINE is always present, and within the request's maxDeadlineSec.",
	"Amounts stay within the user's stated budget, PER TOKEN, summed across every strategy in the recommendation. Never a token the user did not select.",
	"The virtual amounts set both the price (their ratio) and the depth (their size). For a pair that should trade near parity, ship equal nominal value on each side — mind that decimals differ, so 10000 USDC is 10000e6 and 10000 USDe is 10000e18.",
	`feeBps is out of ${FEE_BPS_ONE}, not 10000: 0.3% is ${(FEE_BPS_ONE / 1000) * 3}.`,
];

export type Template = {
	id: string;
	label: string;
	describesIntent: string;
	curve: string;
	wrappers: string[];
	shape: string;
};

/// Known-good seed shapes. Every template here compiles today — that is the
/// point. A template naming an instruction we cannot build is the exact bug this
/// file previously had.
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
];

export function grammarPromptBlock(): string {
	const byRole = (role: Role) =>
		INSTRUCTIONS.filter((i) => i.role === role)
			.map((i) => `    ${i.name} — ${i.summary}${i.params ? `\n        params: ${i.params}` : ""}`)
			.join("\n");

	return [
		"INSTRUCTION SET (this is the COMPLETE menu — nothing else exists on this venue):",
		"  guards (optional, before everything):",
		byRole("guard"),
		"  wrappers (optional, MUST come before the curve):",
		byRole("wrapper"),
		"  curve (EXACTLY ONE, and it goes LAST):",
		byRole("curve"),
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

/// Every name this grammar offers must be dispatchable on the pinned venue.
/// Called by the test; exported so a consumer can assert it at startup too.
export function unknownInstructions(): string[] {
	return [...INSTRUCTIONS.map((i) => i.name), ...COMPILER_EMITTED, ...Object.keys(OMITTED)].filter(
		(name) => OP[name] === undefined,
	);
}
