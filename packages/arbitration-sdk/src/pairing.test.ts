import { test } from "node:test";
import assert from "node:assert/strict";
import { pairingPlan, pairingPromptBlock } from "./pairing.ts";
import { stubContext, TOKENS, type MarketContext } from "./context.ts";
import type { RecommendationRequest } from "./recommendation.ts";

const CTX = stubContext(); // WETH/USDC, mid 3450
const WETH = TOKENS.WETH.address;
const USDC = TOKENS.USDC.address;

function req(
	budget: RecommendationRequest["budget"],
	over: Partial<RecommendationRequest> = {},
): RecommendationRequest {
	return {
		prompt: "market-make WETH/USDC",
		budget,
		maxStrategies: 3,
		maxDeadlineSec: 604_800,
		...over,
	};
}

const both = (weth: string, usdc: string) => [
	{ symbol: "WETH", address: WETH, amount: weth },
	{ symbol: "USDC", address: USDC, amount: usdc },
];

test("the binding ceiling decides the size — USDC binds against a large WETH budget", () => {
	// 2 WETH is 6900 USDC of value at mid 3450, but only 3000 USDC is offered.
	const p = pairingPlan(CTX, req(both("2", "3000")), 3);
	assert.ok(p);
	assert.equal(p.binding, "USDC");
	// Legs come back in canonical ascending address order: WETH (0x42…) first.
	assert.equal(p.legs[0].symbol, "WETH");
	assert.equal(p.legs[1].symbol, "USDC");
	// 3000 / 3450 = 0.869565…, truncated to 6 dp.
	assert.equal(p.legs[0].total, "0.869565");
	assert.equal(p.legs[1].total, "3000");
});

test("the other side binds when it is the scarce one", () => {
	// 0.5 WETH is 1725 USDC of value; 10000 USDC is far more than needed.
	const p = pairingPlan(CTX, req(both("0.5", "10000")), 3);
	assert.ok(p);
	assert.equal(p.binding, "WETH");
	assert.equal(p.legs[0].total, "0.5");
	assert.equal(p.legs[1].total, "1725");
});

test("the shipped ratio is the mid, not the ratio of the two ceilings", () => {
	const p = pairingPlan(CTX, req(both("2", "3000")), 1);
	assert.ok(p);
	// total USDC / total WETH must reproduce the mid (3000 / 0.869565 ≈ 3450).
	const implied = Number(p.legs[1].total) / Number(p.legs[0].total);
	assert.ok(Math.abs(implied - 3450) < 0.01, `implied ${implied}`);
});

test("per-strategy shares are truncated down, so N of them never exceed the budget (I2)", () => {
	const p = pairingPlan(CTX, req(both("2", "3000")), 3);
	assert.ok(p);
	assert.equal(p.legs[1].perStrategy, "1000"); // 3000 / 3
	// 0.869565 / 3 = 0.289855 exactly at 6 dp; the sum must not exceed the total.
	assert.equal(p.legs[0].perStrategy, "0.289855");
	const summed = 3 * Number(p.legs[0].perStrategy);
	assert.ok(summed <= Number(p.legs[0].total), `${summed} > ${p.legs[0].total}`);
});

test("a share that does not divide evenly rounds DOWN, never up", () => {
	// 1000 USDC across 3 strategies = 333.333333… — truncated, so 3 shares are
	// strictly less than the ceiling. Rounding up would breach it.
	const p = pairingPlan(CTX, req(both("1", "1000")), 3);
	assert.ok(p);
	assert.equal(p.legs[1].perStrategy, "333.333333");
	assert.ok(3 * Number(p.legs[1].perStrategy) < 1000);
});

test("no plan when the budget does not hold both sides of the pair", () => {
	assert.equal(
		pairingPlan(CTX, req([{ symbol: "USDC", address: USDC, amount: "1000" }]), 3),
		null,
	);
});

test("no plan when the mid is unusable — never a fabricated price", () => {
	const zeroMid: MarketContext = { ...CTX, pair: { ...CTX.pair, midPrice: 0 } };
	assert.equal(pairingPlan(zeroMid, req(both("2", "3000")), 3), null);

	const expMid: MarketContext = { ...CTX, pair: { ...CTX.pair, midPrice: 1e-7 } };
	assert.equal(pairingPlan(expMid, req(both("2", "3000")), 3), null);
});

test("arithmetic is exact, not floating point", () => {
	// 0.1 + 0.1 + 0.1 is 0.30000000000000004 in IEEE-754. Three shares of a 0.3
	// ceiling must not exceed it.
	const p = pairingPlan(CTX, req(both("0.3", "10000")), 3);
	assert.ok(p);
	assert.equal(p.legs[0].total, "0.3");
	assert.equal(p.legs[0].perStrategy, "0.1");
});

test("the block tells the model to echo, and names the binding side", () => {
	const block = pairingPromptBlock(pairingPlan(CTX, req(both("2", "3000")), 3));
	assert.ok(/ECHO these numbers/i.test(block), block);
	assert.ok(block.includes("0.869565"), block);
	assert.ok(block.includes("USDC is the binding ceiling"), block);
	assert.ok(block.includes("per strategy"), block);
});

test("no plan renders as nothing at all, not as an empty heading", () => {
	assert.equal(pairingPromptBlock(null), "");
});
