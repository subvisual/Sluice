import test from "node:test";
import assert from "node:assert/strict";
import { PROMPT_VERSION } from "./compose.ts";
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
	// The fallback draws strictly on the user's budget and passes the validator
	// on the WALL clock: nothing was fetched, so the deadline bound and the stub
	// snapshot share the request's single `now`.
	assert.equal(res.recommendation.strategies.length, 1);
	assert.deepEqual(res.recommendation.strategies[0].tokens, [
		WETH.address,
		USDC.address,
	]);
	assert.deepEqual(res.validation, { ok: true, violations: [] });
	// Nothing was fetched, so the book is a stub — and the response says so.
	assert.equal(res.contextSource, "stub");
	assert.equal(res.promptVersion, PROMPT_VERSION);
});

test("composeForApp sorts the budget into canonical token order (I10)", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	// Reversed input must not produce an I10 violation in the fallback.
	const res = await composeForApp({ ...INPUT, budget: [USDC, WETH] });
	assert.deepEqual(res.recommendation.strategies[0].tokens, [
		WETH.address,
		USDC.address,
	]);
	assert.equal(res.validation.ok, true);
});

test("composeForApp result survives JSON round-tripping", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	const res = await composeForApp(INPUT);
	assert.deepEqual(JSON.parse(JSON.stringify(res)), res);
});

test("composeForApp returns compiled shipInputs, one per strategy", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	const res = await composeForApp(INPUT);

	assert.equal(res.shipInputs.length, res.recommendation.strategies.length);
	for (const [i, shipInput] of res.shipInputs.entries()) {
		const strategy = res.recommendation.strategies[i];
		assert.match(shipInput.strategyHash, /^0x[0-9a-fA-F]{64}$/);
		assert.equal(shipInput.strategyHash.length, 66);
		assert.equal(shipInput.amounts.length, shipInput.tokens.length);
		assert.equal(shipInput.tokens.length, strategy.tokens.length);
	}
});

test("composeForApp degrades to shipInputs: [] instead of throwing when a budget token is unknown to the SDK", async () => {
	delete process.env.ZG_PRIVATE_KEY;
	// Not in the config token list — compileRecommendation's decimalsOf() throws
	// on any address the address book does not carry, and fallbackResult must not
	// let that escape.
	const UNKNOWN = {
		address: "0x1111111111111111111111111111111111111111",
		symbol: "UNKNOWN",
		decimals: 18,
		amount: "1000000000000000000",
	};
	const res = await composeForApp({ ...INPUT, budget: [UNKNOWN] });

	assert.equal(res.source, "TEMPLATE_FALLBACK");
	assert.deepEqual(res.shipInputs, []);
});
