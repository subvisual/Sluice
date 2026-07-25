import test from "node:test";
import assert from "node:assert/strict";
import { budgetEntryToDecimal, composeForApp } from "./serve.ts";

const WETH = {
	address: "0x4200000000000000000000000000000000000006",
	symbol: "WETH",
	decimals: 18,
	amount: "2000000000000000000",
};
const USDC = {
	address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	symbol: "USDC",
	decimals: 6,
	amount: "3000000000",
};
const INPUT = {
	user: "0x471e8aad77a1a29335081850b4e34fa7863f762a",
	prompt: "market-make WETH/USDC and earn fees in a tight band",
	budget: [WETH, USDC],
	maxStrategies: 3,
	maxDeadlineSec: 7 * 24 * 60 * 60,
};

test("budgetEntryToDecimal converts base units to decimal strings", () => {
	assert.deepEqual(budgetEntryToDecimal(WETH), {
		symbol: "WETH",
		address: WETH.address,
		amount: "2.0",
	});
	assert.deepEqual(budgetEntryToDecimal(USDC), {
		symbol: "USDC",
		address: USDC.address,
		amount: "3000.0",
	});
});

test("composeForApp without ZG_PRIVATE_KEY returns a labelled, valid fallback", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	const res = await composeForApp(INPUT);

	assert.equal(res.source, "TEMPLATE_FALLBACK");
	assert.match(res.reason ?? "", /ZG_PRIVATE_KEY/);
	assert.equal(res.proof, null);
	assert.equal(res.messages, null);
	assert.equal(res.attempts, 0);
	// The fallback draws strictly on the user's budget, and it passes the validator.
	assert.equal(res.recommendation.strategies.length, 1);
	assert.deepEqual(res.recommendation.strategies[0].tokens, [WETH.address, USDC.address]);
	assert.deepEqual(res.validation, { ok: true, violations: [] });
});

test("composeForApp sorts the budget into canonical token order (I10)", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	// Reversed input must not produce an I10 violation in the fallback.
	const res = await composeForApp({ ...INPUT, budget: [USDC, WETH] });
	assert.deepEqual(res.recommendation.strategies[0].tokens, [WETH.address, USDC.address]);
	assert.equal(res.validation.ok, true);
});

test("composeForApp result survives JSON round-tripping", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	const res = await composeForApp(INPUT);
	assert.deepEqual(JSON.parse(JSON.stringify(res)), res);
});
