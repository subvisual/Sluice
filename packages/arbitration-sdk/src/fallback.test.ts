import { test } from "node:test";
import assert from "node:assert/strict";
import {
	templateFallback,
	selectTemplate,
	FALLBACK_SOURCE,
} from "./fallback.ts";
import {
	parseRecommendation,
	type RecommendationRequest,
} from "./recommendation.ts";
import { stubContext } from "./context.ts";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const req: RecommendationRequest = {
	prompt: "sell my ETH if it hits 3500, all at once",
	budget: [{ symbol: "WETH", address: WETH, amount: "2" }],
	maxStrategies: 3,
	maxDeadlineSec: 604800,
};

test("the fallback is well-formed — parseRecommendation accepts it with no errors", () => {
	const rec = templateFallback(req, stubContext());
	const parsed = parseRecommendation(JSON.stringify(rec), req);
	assert.equal(parsed.ok, true);
	assert.deepEqual(parsed.errors, []);
});

test("the fallback draws only on the stated budget (tokens + amounts)", () => {
	const multi: RecommendationRequest = {
		...req,
		budget: [
			{ symbol: "WETH", address: WETH, amount: "1" },
			{ symbol: "USDC", address: USDC, amount: "3000" },
		],
	};
	const s = templateFallback(multi, stubContext()).strategies[0];
	assert.deepEqual(s.tokens, [WETH, USDC]);
	assert.deepEqual(s.virtualAmounts, ["1", "3000"]);
});

test("the fallback deadline stays within maxDeadlineSec", () => {
	const ctx = stubContext();
	const s = templateFallback(req, ctx).strategies[0];
	assert.ok(s.slots.deadline.deadline > ctx.observedAt);
	assert.ok(s.slots.deadline.deadline <= ctx.observedAt + req.maxDeadlineSec);
});

test("the fallback carries exactly one strategy (within maxStrategies)", () => {
	const rec = templateFallback(req, stubContext());
	assert.equal(rec.strategies.length, 1);
	assert.ok(rec.strategies.length <= req.maxStrategies);
});

test("the fallback is deterministic — same inputs, identical output", () => {
	const a = templateFallback(req, stubContext());
	const b = templateFallback(req, stubContext());
	assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("selectTemplate matches all-or-nothing intent to T3, rangebound to T1", () => {
	assert.equal(
		selectTemplate("sell my ETH if it hits 3500, all at once").id,
		"T3",
	);
	assert.equal(
		selectTemplate("earn fees on ETH/USDC, rangebound this week").id,
		"T1",
	);
});

test("selectTemplate falls back to T1 for an unrecognised intent", () => {
	assert.equal(selectTemplate("do something with my tokens").id, "T1");
});

test("FALLBACK_SOURCE is the labelled, non-model source", () => {
	assert.equal(FALLBACK_SOURCE, "TEMPLATE_FALLBACK");
});
