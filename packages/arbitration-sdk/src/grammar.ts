// The six-slot SwapVM strategy grammar and the seed templates, as data.
//
// Source: F1 Notion page §4 (templates) and §5 (slot grammar).
//
// ⚠️ PROVISIONAL — read before trusting this for anything but a demo.
// F1 §5 is explicitly marked "the validator must not be built against it" until
// Open Q2 is settled against the forked SwapVM bytecode. Known discrepancies
// with the 1inch source:
//   • `_xycConcentrateGrowLiquidityXD` (templates T1/T2) is NOT a real opcode —
//     the source has `XYCConcentrateSwap` (0x51). We keep the F1 name here so
//     this file matches the page; do not feed it to a real compiler.
//   • "exactly one swap-logic instruction" is NOT a protocol rule — SwapVM is a
//     jump VM with no mandated canonical order.
//   • the slot-3 rule contradicts template T1 (which pairs a CLMM curve with a
//     partial-fill instruction).
// This grammar is therefore used ONLY as the model's menu to produce a
// grammar-SHAPED recommendation. It is not grammar-CORRECT and will not compile
// or ship. Nothing here verifies or validates for correctness (out of scope).

export type SlotSpec = {
	index: number;
	name: string;
	required: "yes" | "optional" | "always";
	options: string[];
	note?: string;
};

// F1 §5 slot table, verbatim shape.
export const SLOTS: SlotSpec[] = [
	{
		index: 1,
		name: "balances (balance setup)",
		required: "yes",
		options: ["perTokenSetup"],
	},
	{ index: 2, name: "fees", required: "optional", options: ["feeConfig"] },
	{
		index: 3,
		name: "swapLogic",
		required: "always",
		options: [
			"_xycConcentrateGrowLiquidityXD",
			"_limitSwap1D",
			"_limitSwapOnlyFull1D",
			"_dynamicBalancesXD",
		],
		note: "exactly one (F1 §5 — provisional)",
	},
	{
		index: 4,
		name: "oracleAdjust",
		required: "optional",
		options: ["_oraclePriceAdjuster1D"],
	},
	{
		index: 5,
		name: "invalidation",
		required: "yes",
		options: [
			"_invalidateTokenIn1D",
			"_invalidateTokenOut1D",
			"_invalidateBit1D",
		],
	},
	{ index: 6, name: "deadline", required: "always", options: ["_deadline"] },
];

// F1 §5 compatibility rules — stated to the model so it complies on the first
// attempt more often. We do NOT enforce them here (that is the validator, out
// of scope); they are prompt guidance only.
export const COMPAT_RULES: string[] = [
	"Partial fill requires token invalidation: if swapLogic is `_limitSwap1D`, invalidation must be `_invalidateTokenIn1D` or `_invalidateTokenOut1D` (prevents overfill).",
	"Exactly one swap-logic instruction in slot 3.",
	"`_deadline` is always present, and within the request's maxDeadlineSec.",
	"Amounts stay within the user's stated budget, per token. Never a token the user did not select, nor more than they allowed.",
	"Oracle adjuster (slot 4) only when a price feed exists for the pair.",
];

export type Template = {
	id: string; // Hex32 in the real system; a readable id is fine for the demo.
	label: string;
	describesIntent: string;
	swapLogic: string;
	invalidation: string;
	shape: string; // one-line human description of the slot filling
};

// F1 §4 — the three seed shapes.
export const TEMPLATES: Template[] = [
	{
		id: "T1",
		label: "tight-clmm · flow capture",
		describesIntent: "earn fees on a pair I expect to stay rangebound",
		swapLogic: "_xycConcentrateGrowLiquidityXD",
		invalidation: "_invalidateTokenIn1D",
		shape: "narrow-band CLMM + partial fills; high fill rate, thin edge",
	},
	{
		id: "T2",
		label: "wide-clmm · patient liquidity",
		describesIntent: "I want exposure but I am not confident about the range",
		swapLogic: "_xycConcentrateGrowLiquidityXD",
		invalidation: "_invalidateTokenIn1D",
		shape: "wide-band CLMM; fills rarely, holds a large commitment",
	},
	{
		id: "T3",
		label: "oracle-limit · a level, not a range",
		describesIntent:
			"sell my ETH if it reaches X — a target, executed all-or-nothing",
		swapLogic: "_limitSwapOnlyFull1D",
		invalidation: "_invalidateBit1D",
		shape:
			"oracle-priced limit; all-or-nothing, can draw its full amount in one fill",
	},
];

// The valid swap-logic options, for the light structural note in the codec.
export const SWAP_LOGIC_OPTIONS = SLOTS[2].options;
export const INVALIDATION_OPTIONS = SLOTS[4].options;

// Render the grammar + templates + rules as a prompt block.
export function grammarPromptBlock(): string {
	const slotLines = SLOTS.map(
		(s) =>
			`  slot ${s.index} — ${s.name} [${s.required}]: ${s.options.join(", ")}` +
			(s.note ? `  (${s.note})` : ""),
	).join("\n");
	const tmplLines = TEMPLATES.map(
		(t) =>
			`  ${t.id} (${t.label}) — intent: "${t.describesIntent}"\n` +
			`      swapLogic=${t.swapLogic}, invalidation=${t.invalidation}; ${t.shape}`,
	).join("\n");
	const ruleLines = COMPAT_RULES.map((r) => `  - ${r}`).join("\n");
	return [
		"SLOT GRAMMAR (fill each slot with one option; order is fixed):",
		slotLines,
		"",
		"COMPATIBILITY RULES:",
		ruleLines,
		"",
		"SEED TEMPLATES (pick one as a starting shape and parameterise it):",
		tmplLines,
	].join("\n");
}
