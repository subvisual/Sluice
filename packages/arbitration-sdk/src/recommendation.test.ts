import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseRecommendation,
	type RecommendationRequest,
} from "./recommendation.ts";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const req: RecommendationRequest = {
	prompt: "sell my ETH if it hits 3500",
	budget: [{ symbol: "WETH", address: WETH, amount: "2" }],
	maxStrategies: 3,
	maxDeadlineSec: 604800,
};

function goodPayload() {
	return {
		schema: "sluice.recommendation/1",
		chainId: 8453,
		observedAt: 1750000000,
		observedBlock: 22500000,
		strategies: [
			{
				templateId: "full-range",
				slots: {
					curve: { instruction: "XYC_SWAP_XD" },
					deadline: { deadline: 1750600000 },
				},
				tokens: [WETH],
				virtualAmounts: ["2"],
			},
		],
	};
}

test("parses a well-formed recommendation, even inside markdown fences", () => {
	const text = "```json\n" + JSON.stringify(goodPayload()) + "\n```";
	const r = parseRecommendation(text, req);
	assert.equal(r.ok, true);
	assert.equal(r.errors.length, 0);
	assert.equal(r.recommendation?.strategies[0].templateId, "full-range");
});

test("fails when strategies is empty", () => {
	const p = goodPayload();
	p.strategies = [];
	const r = parseRecommendation(JSON.stringify(p), req);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /strategies/.test(e)));
});

test("fails when a virtualAmount is a JS number, not a decimal string", () => {
	const p: any = goodPayload();
	p.strategies[0].virtualAmounts = [2];
	const r = parseRecommendation(JSON.stringify(p), req);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /decimal string/.test(e)));
});

test("notes (does not fail) an amount over budget", () => {
	const p = goodPayload();
	p.strategies[0].virtualAmounts = ["5"]; // budget is 2
	const r = parseRecommendation(JSON.stringify(p), req);
	assert.equal(r.ok, true);
	assert.ok(r.notes.some((n) => /exceeds budget/.test(n)));
});

test("notes an instruction that is not on this venue, without failing the parse", () => {
	const p = goodPayload();
	p.strategies[0].slots.curve.instruction = "_limitSwapOnlyFull1D";
	const r = parseRecommendation(JSON.stringify(p), req);
	assert.equal(r.ok, true);
	assert.ok(r.notes.some((n) => /is not a curve on this venue/.test(n)));
});

test("returns ok:false on non-JSON output", () => {
	const r = parseRecommendation("I cannot help with that.", req);
	assert.equal(r.ok, false);
});
