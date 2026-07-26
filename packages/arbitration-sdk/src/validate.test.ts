import { test } from "node:test";
import assert from "node:assert/strict";
import {
	validate,
	DEFAULT_MAX_BLOCK_LAG,
	type ChainState,
} from "./validate.ts";
import type {
	RecommendationRequest,
	SlotAssignment,
	StrategyRecommendation,
} from "./recommendation.ts";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";

const OBSERVED_BLOCK = 22_500_000;
const NOW = 1_750_000_000;
const DEADLINE = NOW + 604_800; // now + maxDeadlineSec — the inclusive upper bound

function strat(tokens: string[], amounts: string[]): SlotAssignment {
	// A grammar-valid strategy: known template, the one curve on this venue, a
	// deadline inside the request bound. Tests override a field to break one invariant.
	return {
		templateId: "full-range",
		slots: {
			curve: { instruction: "XYC_SWAP_XD" },
			deadline: { deadline: DEADLINE },
		},
		tokens,
		virtualAmounts: amounts,
	};
}

function rec(
	strategies: SlotAssignment[],
	over: Partial<StrategyRecommendation> = {},
): StrategyRecommendation {
	return {
		schema: "sluice.recommendation/1",
		chainId: 8453,
		observedAt: 1_750_000_000,
		observedBlock: OBSERVED_BLOCK,
		strategies,
		...over,
	};
}

const req: RecommendationRequest = {
	prompt: "sell my ETH if it hits 3500, all at once",
	budget: [{ symbol: "WETH", address: WETH, amount: "2" }],
	maxStrategies: 3,
	maxDeadlineSec: 604_800,
};

// Head is a few blocks ahead of the observed snapshot: fresh under the default lag.
const fresh: ChainState = {
	chainId: 8453,
	headBlock: OBSERVED_BLOCK + 10,
	now: NOW,
};

const codes = (r: StrategyRecommendation, q = req, s = fresh) =>
	validate(r, q, s).map((v) => v.code);

test("a clean, in-budget, single-strategy recommendation has no violations", () => {
	assert.deepEqual(validate(rec([strat([WETH], ["2"])]), req, fresh), []);
});

test("I1 — a token the user never selected is rejected", () => {
	const r = rec([strat([WETH, DAI], ["1", "500"])]);
	assert.ok(codes(r).includes("I1"));
});

test("I2 — amounts within budget per-strategy but OVER budget when summed across strategies", () => {
	// Two legs, each ≤ 2 WETH alone, but 1.5 + 1 = 2.5 > 2 total.
	const r = rec([strat([WETH], ["1.5"]), strat([WETH], ["1"])]);
	const c = codes(r);
	assert.ok(c.includes("I2"));
	assert.ok(!c.includes("I1")); // WETH is a budgeted token
});

test("I2 — the boundary is inclusive: sum exactly equal to budget is allowed", () => {
	const r = rec([strat([WETH], ["1.2"]), strat([WETH], ["0.8"])]); // 1.2 + 0.8 == 2
	assert.ok(!codes(r).includes("I2"));
});

test("I2 — decimal sums are exact, not floating point (0.1+0.1+0.1 <= 0.3)", () => {
	// In IEEE-754, 0.1+0.1+0.1 == 0.30000000000000004 > 0.3 — a Number-based
	// check would wrongly flag this.
	const q: RecommendationRequest = {
		...req,
		budget: [{ symbol: "WETH", address: WETH, amount: "0.3" }],
	};
	const r = rec([
		strat([WETH], ["0.1"]),
		strat([WETH], ["0.1"]),
		strat([WETH], ["0.1"]),
	]);
	assert.ok(!validate(r, q, fresh).some((v) => v.code === "I2"));
});

test("I2 — fractional overflow is caught (0.6 + 0.5 > 1)", () => {
	const q: RecommendationRequest = {
		...req,
		budget: [{ symbol: "WETH", address: WETH, amount: "1" }],
	};
	const r = rec([strat([WETH], ["0.6"]), strat([WETH], ["0.5"])]);
	assert.ok(validate(r, q, fresh).some((v) => v.code === "I2"));
});

test("I2 — sums are tracked per token independently", () => {
	const q: RecommendationRequest = {
		...req,
		budget: [
			{ symbol: "WETH", address: WETH, amount: "2" },
			{ symbol: "USDC", address: USDC, amount: "3000" },
		],
	};
	// WETH within budget (1+0.5=1.5<=2); USDC over (2000+2000=4000>3000).
	const r = rec([
		strat([WETH, USDC], ["1", "2000"]),
		strat([WETH, USDC], ["0.5", "2000"]),
	]);
	assert.ok(validate(r, q, fresh).some((v) => v.code === "I2"));
});

test("I3 — more strategies than maxStrategies is rejected", () => {
	const q: RecommendationRequest = { ...req, maxStrategies: 1 };
	const r = rec([strat([WETH], ["1"]), strat([WETH], ["0.5"])]);
	assert.ok(validate(r, q, fresh).some((v) => v.code === "I3"));
});

test("I3 — an empty strategy set is rejected", () => {
	assert.ok(codes(rec([])).includes("I3"));
});

test("I4 — a recommendation for the wrong chain is rejected", () => {
	const r = rec([strat([WETH], ["2"])], { chainId: 1 });
	assert.ok(codes(r).includes("I4"));
});

test("I12 — a snapshot older than the freshness bound is rejected", () => {
	const stale: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK + DEFAULT_MAX_BLOCK_LAG + 1,
		now: NOW,
	};
	assert.ok(codes(rec([strat([WETH], ["2"])]), req, stale).includes("I12"));
});

test("I12 — a snapshot from the future (ahead of head) is rejected", () => {
	const behind: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK - 1,
		now: NOW,
	};
	assert.ok(codes(rec([strat([WETH], ["2"])]), req, behind).includes("I12"));
});

test("I12 — a snapshot exactly at head is fresh", () => {
	const atHead: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK,
		now: NOW,
	};
	assert.ok(!codes(rec([strat([WETH], ["2"])]), req, atHead).includes("I12"));
});

test("I12 — an explicit maxBlockLag overrides the default", () => {
	const s: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK + 5,
		now: NOW,
		maxBlockLag: 3,
	};
	assert.ok(codes(rec([strat([WETH], ["2"])]), req, s).includes("I12"));
});

test("multiple simultaneous violations are all reported", () => {
	const q: RecommendationRequest = { ...req, maxStrategies: 1 };
	// wrong chain (I4), unknown token DAI (I1), 2 strategies over max of 1 (I3).
	const r = rec([strat([WETH], ["1"]), strat([DAI], ["1"])], { chainId: 1 });
	const c = validate(r, q, fresh).map((v) => v.code);
	assert.ok(c.includes("I1"));
	assert.ok(c.includes("I3"));
	assert.ok(c.includes("I4"));
});

test("validate never mutates its inputs", () => {
	const r = rec([strat([WETH, USDC], ["1", "2000"]), strat([WETH], ["5"])]);
	const q: RecommendationRequest = { ...req, maxStrategies: 1 };
	const before = JSON.stringify({ r, q, fresh });
	validate(r, q, fresh);
	assert.equal(JSON.stringify({ r, q, fresh }), before);
});

// ---- Grammar invariants (I5, I7, I8, I10, I11), against the real menu ----

test("I5 — a curve that is not on this venue is rejected", () => {
	const bad = strat([WETH], ["2"]);
	bad.slots.curve = { instruction: "XYC_CONCENTRATE_GROW_LIQUIDITY_XD" }; // omitted, not offered
	assert.ok(codes(rec([bad])).includes("I5"));
});

test("I5 — a fee wrapper that is not offered is rejected", () => {
	const bad = strat([WETH], ["2"]);
	bad.slots.fee = { instruction: "PROGRESSIVE_FEE_IN_XD" };
	assert.ok(codes(rec([bad])).includes("I5"));
});

test("I5 — feeBps out of [1, 1e9) is rejected, in-range is accepted", () => {
	const over = strat([WETH], ["2"]);
	over.slots.fee = {
		instruction: "FLAT_FEE_AMOUNT_IN_XD",
		params: { feeBps: 1_000_000_000 }, // == 1e9, not strictly < 1e9
	};
	assert.ok(codes(rec([over])).includes("I5"));

	const ok = strat([WETH], ["2"]);
	ok.slots.fee = {
		instruction: "FLAT_FEE_AMOUNT_IN_XD",
		params: { feeBps: 3_000_000 }, // 0.3%
	};
	assert.ok(!codes(rec([ok])).includes("I5"));
});

test("I5 — a fee slot that charges nothing is rejected, and the fix is structural", () => {
	// feeBps 0 compiles to a FLAT_FEE_AMOUNT_IN_XD that takes nothing: bytes and
	// gas for a fee the screen can only describe as absent (#44). The message
	// must send the model to the no-fee template, not to a different number.
	const zero = strat([WETH], ["2"]);
	zero.slots.fee = {
		instruction: "FLAT_FEE_AMOUNT_IN_XD",
		params: { feeBps: 0 },
	};
	assert.ok(codes(rec([zero])).includes("I5"));
	const m = msg(rec([zero]), "I5");
	assert.ok(m.includes("full-range"), m);
	assert.ok(m.includes("drop the fee slot"), m);
	// One violation, not two — the range message would name a different fix.
	assert.equal(codes(rec([zero])).filter((c) => c === "I5").length, 1);
});

test("I5 — a guard is rejected (no guard is offered on this venue)", () => {
	const bad = strat([WETH], ["2"]);
	bad.slots.guards = [{ instruction: "ONLY_TAKER_TOKEN_BALANCE_GTE" }];
	assert.ok(codes(rec([bad])).includes("I5"));
});

test("I7 — a deadline past now + maxDeadlineSec is rejected", () => {
	const bad = strat([WETH], ["2"]);
	bad.slots.deadline = { deadline: NOW + 604_800 + 1 };
	assert.ok(codes(rec([bad])).includes("I7"));
});

test("I7 — a deadline already in the past is rejected", () => {
	const bad = strat([WETH], ["2"]);
	bad.slots.deadline = { deadline: NOW - 1 };
	assert.ok(codes(rec([bad])).includes("I7"));
});

test("I8 — an unknown templateId is rejected", () => {
	const bad = strat([WETH], ["2"]);
	bad.templateId = "T1"; // an old, no-longer-existent template
	assert.ok(codes(rec([bad])).includes("I8"));
});

test("I10 — tokens out of canonical (ascending) order are rejected", () => {
	// USDC (0x8335…) before WETH (0x4200…) inverts the pair.
	const bad = strat([USDC, WETH], ["3000", "1"]);
	const q: RecommendationRequest = {
		...req,
		budget: [
			{ symbol: "WETH", address: WETH, amount: "2" },
			{ symbol: "USDC", address: USDC, amount: "5000" },
		],
	};
	assert.ok(validate(rec([bad]), q, fresh).some((v) => v.code === "I10"));
});

test("I10 — canonical (ascending) order passes", () => {
	const good = strat([WETH, USDC], ["1", "3000"]);
	const q: RecommendationRequest = {
		...req,
		budget: [
			{ symbol: "WETH", address: WETH, amount: "2" },
			{ symbol: "USDC", address: USDC, amount: "5000" },
		],
	};
	assert.ok(!validate(rec([good]), q, fresh).some((v) => v.code === "I10"));
});

test("I11 — a zero virtual amount is rejected", () => {
	assert.ok(codes(rec([strat([WETH], ["0"])])).includes("I11"));
	assert.ok(codes(rec([strat([WETH], ["0.00"])])).includes("I11"));
});

test("the fully-valid fixture emits no grammar violations", () => {
	const c = codes(rec([strat([WETH], ["2"])]));
	for (const code of ["I5", "I7", "I8", "I10", "I11"])
		assert.ok(!c.includes(code as any), `unexpected ${code}`);
});

test("never emits an N/A invariant — I6, I9", () => {
	// I6 (partial-fill⇒invalidation) and I9 (oracle⇒feed) have NO opcode on this
	// router, so a maximally-broken recommendation must still only fire in-scope codes.
	const broken = strat([USDC, WETH], ["0"]); // bad order + zero amount + short amounts
	broken.templateId = "nope";
	broken.slots.curve = { instruction: "DECAY_XD" };
	broken.slots.fee = {
		instruction: "FLAT_FEE_AMOUNT_IN_XD",
		params: { feeBps: 2e9 },
	};
	broken.slots.deadline = { deadline: NOW - 10 };
	broken.slots.guards = [{ instruction: "JUMP" }];
	const r = rec([broken, strat([DAI], ["1"])], { chainId: 42 });
	const q: RecommendationRequest = { ...req, maxStrategies: 1 };
	const stale: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK + 10_000,
		now: NOW,
	};
	const emitted = new Set<string>(validate(r, q, stale).map((v) => v.code));
	const allowed = new Set([
		"I1",
		"I2",
		"I3",
		"I4",
		"I5",
		"I7",
		"I8",
		"I10",
		"I11",
		"I12",
	]);
	for (const code of emitted)
		assert.ok(allowed.has(code), `unexpected code ${code}`);
	for (const forbidden of ["I6", "I9"])
		assert.ok(!emitted.has(forbidden), `emitted forbidden ${forbidden}`);
});

// ---- Every message names the fix, wherever the fix is deterministic --------
//
// The rejection feedback IS the next prompt (compose.ts), with one retry. These
// assert the corrective VALUE is in the text, not merely the rule broken once.

const msg = (
	r: StrategyRecommendation,
	code: string,
	q = req,
	s = fresh,
): string => validate(r, q, s).find((v) => v.code === code)?.message ?? "";

test("I1 message lists the tokens the user actually selected", () => {
	const m = msg(rec([strat([WETH, DAI], ["1", "500"])]), "I1");
	assert.ok(m.includes(WETH), m);
	assert.ok(m.includes("WETH"), m);
});

test("I2 message names the cap and says to divide it, not repeat it", () => {
	const m = msg(rec([strat([WETH], ["1.5"]), strat([WETH], ["1"])]), "I2");
	assert.ok(m.includes("divide"), m);
	assert.ok(m.includes("at most 2"), m);
});

test("I3 messages name the permitted strategy count in both directions", () => {
	const q: RecommendationRequest = { ...req, maxStrategies: 1 };
	assert.ok(
		msg(rec([strat([WETH], ["1"]), strat([WETH], ["0.5"])]), "I3", q).includes(
			"at most 1",
		),
	);
	assert.ok(msg(rec([]), "I3", q).includes("between 1 and 1"));
});

test("I4 message names the chainId to set", () => {
	const m = msg(rec([strat([WETH], ["2"])], { chainId: 1 }), "I4");
	assert.ok(m.includes('"chainId": 8453'), m);
});

test("I5 messages name the offered instruction, or say to omit the slot", () => {
	const badCurve = strat([WETH], ["2"]);
	badCurve.slots.curve = { instruction: "XYC_CONCENTRATE_GROW_LIQUIDITY_XD" };
	assert.ok(msg(rec([badCurve]), "I5").includes("XYC_SWAP_XD"));

	const badFee = strat([WETH], ["2"]);
	badFee.slots.fee = { instruction: "PROGRESSIVE_FEE_IN_XD" };
	assert.ok(msg(rec([badFee]), "I5").includes("FLAT_FEE_AMOUNT_IN_XD"));

	// No guard has an encoder on this venue: the fix is to drop the slot, and an
	// empty menu must read as an answer rather than as a truncated sentence.
	const badGuard = strat([WETH], ["2"]);
	badGuard.slots.guards = [{ instruction: "ONLY_TAKER_TOKEN_BALANCE_GTE" }];
	assert.ok(msg(rec([badGuard]), "I5").includes("omit the guards slot"));
});

test("I5 feeBps message carries the scale, in the units that trip a model", () => {
	const over = strat([WETH], ["2"]);
	over.slots.fee = {
		instruction: "FLAT_FEE_AMOUNT_IN_XD",
		params: { feeBps: 30 }, // 0.3% in the 10000-scale the model knows
	};
	// 30 is a valid integer in [1, 1e9), so this specific value does NOT fire —
	// the scale hint belongs to the out-of-range case.
	const huge = strat([WETH], ["2"]);
	huge.slots.fee = {
		instruction: "FLAT_FEE_AMOUNT_IN_XD",
		params: { feeBps: 2_000_000_000 },
	};
	assert.equal(codes(rec([over])).includes("I5"), false);
	assert.ok(msg(rec([huge]), "I5").includes("3000000"));
});

test("I7 messages name the exact deadline to use", () => {
	const late = strat([WETH], ["2"]);
	late.slots.deadline = { deadline: DEADLINE + 1 };
	assert.ok(msg(rec([late]), "I7").includes(`use ${DEADLINE}`));

	const missing = strat([WETH], ["2"]);
	// The parser rejects a missing deadline before the validator ever sees one,
	// so this shape only reaches here through a direct validate() call.
	delete (missing.slots as { deadline?: unknown }).deadline;
	assert.ok(msg(rec([missing]), "I7").includes(String(DEADLINE)));
});

test("I8 message lists the known template ids", () => {
	const bad = strat([WETH], ["2"]);
	bad.templateId = "T1";
	const m = msg(rec([bad]), "I8");
	assert.ok(m.includes("full-range"), m);
	assert.ok(m.includes("banded"), m);
});

test("I10 message gives the sorted order and says to move the amounts with it", () => {
	const q: RecommendationRequest = {
		...req,
		budget: [
			{ symbol: "WETH", address: WETH, amount: "2" },
			{ symbol: "USDC", address: USDC, amount: "3000" },
		],
	};
	const m = msg(rec([strat([USDC, WETH], ["3000", "1"])]), "I10", q);
	// WETH (0x4200…) sorts before USDC (0x8335…) — the corrected array, verbatim.
	assert.ok(m.includes(JSON.stringify([WETH, USDC])), m);
	assert.ok(m.includes("virtualAmount"), m);
});

test("I11 messages say what a valid amount looks like", () => {
	assert.ok(msg(rec([strat([WETH], ["abc"])]), "I11").includes('"0.25"'));
	assert.ok(msg(rec([strat([WETH], ["0"])]), "I11").includes("positive amount"));
});

test("I12 message names the block to use", () => {
	const stale: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK + DEFAULT_MAX_BLOCK_LAG + 1,
		now: NOW,
	};
	const m = msg(rec([strat([WETH], ["2"])]), "I12", req, stale);
	assert.ok(m.includes(`"observedBlock": ${stale.headBlock}`), m);
});
