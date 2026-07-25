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

function strat(tokens: string[], amounts: string[]): SlotAssignment {
	return {
		templateId: "T3",
		slots: {
			balances: { instruction: "perTokenSetup" },
			swapLogic: { instruction: "_limitSwapOnlyFull1D" },
			invalidation: { instruction: "_invalidateBit1D" },
			deadline: { deadline: 1_750_604_800 },
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
const fresh: ChainState = { chainId: 8453, headBlock: OBSERVED_BLOCK + 10 };

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
	// check would wrongly flag this. The validator must not.
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
	};
	assert.ok(codes(rec([strat([WETH], ["2"])]), req, stale).includes("I12"));
});

test("I12 — a snapshot from the future (ahead of head) is rejected", () => {
	const behind: ChainState = { chainId: 8453, headBlock: OBSERVED_BLOCK - 1 };
	assert.ok(codes(rec([strat([WETH], ["2"])]), req, behind).includes("I12"));
});

test("I12 — a snapshot exactly at head is fresh", () => {
	const atHead: ChainState = { chainId: 8453, headBlock: OBSERVED_BLOCK };
	assert.ok(!codes(rec([strat([WETH], ["2"])]), req, atHead).includes("I12"));
});

test("I12 — an explicit maxBlockLag overrides the default", () => {
	const s: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK + 5,
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

test("only the in-scope invariants can fire — never the blocked/deferred ones", () => {
	// This slice implements I1–I4 and I12. I5–I11, I13, I14 are blocked on the
	// F1 grammar or deferred with the commit path; none may ever be emitted here.
	const r = rec([strat([WETH, DAI], ["9"]), strat([USDC], ["1"])], {
		chainId: 999,
	});
	const q: RecommendationRequest = { ...req, maxStrategies: 1 };
	const stale: ChainState = {
		chainId: 8453,
		headBlock: OBSERVED_BLOCK + 10_000,
	};
	const emitted = new Set(validate(r, q, stale).map((v) => v.code));
	const allowed = new Set(["I1", "I2", "I3", "I4", "I12"]);
	for (const code of emitted)
		assert.ok(allowed.has(code), `unexpected ${code}`);
});
