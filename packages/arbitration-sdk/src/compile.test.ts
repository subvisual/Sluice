import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes } from "ethers";
import {
	compileRecommendation,
	saltFor,
	deriveSaltSeed,
	toBaseUnits,
} from "./compile.ts";
import {
	fullRange,
	fullRangeWithFee,
	banded,
	bandedWithFee,
	aquaOrder,
	shipBytes,
	strategyHash,
	toHex,
} from "./swapvm.ts";
import type { StrategyRecommendation } from "./recommendation.ts";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAKER = "0x0000000000000000000000000000000000000abc";

function rec(
	strategies: StrategyRecommendation["strategies"],
): StrategyRecommendation {
	return {
		schema: "sluice.recommendation/1",
		chainId: 8453,
		observedAt: 1_800_000_000,
		observedBlock: 49_100_000,
		strategies,
	};
}

// Salt is 8 bytes (uint64): the derivation must never exceed 2^64-1.
test("saltFor is bounded to uint64 and is deterministic", () => {
	const seed = "0x" + "11".repeat(32);
	const s0 = saltFor(seed, 0);
	const s1 = saltFor(seed, 1);
	assert.ok(s0 < 1n << 64n);
	assert.ok(s1 < 1n << 64n);
	assert.notEqual(s0, s1);
	assert.equal(saltFor(seed, 0), s0); // deterministic
});

// Golden parity: compile must reproduce the EXACT bytes swapvm's builder emits
// for the same salt/params — that equality is the warrant for signing.
test("full-range compiles to the same bytes as the swapvm builder", () => {
	const r = rec([
		{
			templateId: "full-range",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1.5", "5000"],
		},
	]);
	const seed = deriveSaltSeed(r, null);
	const [got] = compileRecommendation(r, MAKER, seed);

	const expectedSalt = saltFor(seed, 0);
	const program = fullRange({ salt: expectedSalt, deadline: 1_800_100_000 });
	const order = aquaOrder(MAKER, program);
	assert.equal(got.strategy, toHex(shipBytes(order)));
	assert.equal(got.strategyHash, strategyHash(order));
	assert.deepEqual(got.tokens, [WETH, USDC]);
	assert.deepEqual(got.amounts, [1_500_000_000_000_000_000n, 5_000_000_000n]); // 18dp, 6dp
});

test("banded compiles to the same bytes as the swapvm builder", () => {
	const r = rec([
		{
			templateId: "banded",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				band: {
					instruction: "XYC_CONCENTRATE_GROW_LIQUIDITY_2D",
					params: { bandBps: 5_000_000 },
				},
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1", "3000"],
		},
	]);
	const seed = deriveSaltSeed(r, null);
	const [got] = compileRecommendation(r, MAKER, seed);
	const program = banded({
		salt: saltFor(seed, 0),
		deadline: 1_800_100_000,
		bandBps: 5_000_000,
		tokens: [WETH, USDC],
		amounts: [1_000_000_000_000_000_000n, 3_000_000_000n],
	});
	assert.equal(got.strategy, toHex(shipBytes(aquaOrder(MAKER, program))));
});

test("a two-strategy recommendation yields two distinct hashes", () => {
	const one = {
		templateId: "full-range",
		slots: {
			curve: { instruction: "XYC_SWAP_XD" },
			deadline: { deadline: 1_800_100_000 },
		},
		tokens: [WETH, USDC],
		virtualAmounts: ["1", "3000"],
	};
	const r = rec([
		one,
		{
			...one,
			templateId: "full-range-fee",
			slots: {
				...one.slots,
				fee: {
					instruction: "FLAT_FEE_AMOUNT_IN_XD",
					params: { feeBps: 3_000_000 },
				},
			},
		},
	]);
	const out = compileRecommendation(r, MAKER, deriveSaltSeed(r, null));
	assert.equal(out.length, 2);
	assert.notEqual(out[0].strategyHash, out[1].strategyHash);
});

test("unknown templateId throws (a bug path, not a user path)", () => {
	const r = rec([
		{
			templateId: "nope",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1", "1"],
		},
	]);
	assert.throws(() => compileRecommendation(r, MAKER, deriveSaltSeed(r, null)));
});

test("banded-fee compiles to the same bytes as the swapvm builder", () => {
	const r = rec([
		{
			templateId: "banded-fee",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				band: {
					instruction: "XYC_CONCENTRATE_GROW_LIQUIDITY_2D",
					params: { bandBps: 5_000_000 },
				},
				fee: {
					instruction: "FLAT_FEE_AMOUNT_IN_XD",
					params: { feeBps: 3_000_000 },
				},
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1", "3000"],
		},
	]);
	const seed = deriveSaltSeed(r, null);
	const [got] = compileRecommendation(r, MAKER, seed);

	const program = bandedWithFee({
		salt: saltFor(seed, 0),
		deadline: 1_800_100_000,
		bandBps: 5_000_000,
		tokens: [WETH, USDC],
		amounts: [1_000_000_000_000_000_000n, 3_000_000_000n],
		feeBps: 3_000_000,
	});
	const order = aquaOrder(MAKER, program);
	assert.equal(got.strategy, toHex(shipBytes(order)));
	assert.equal(got.strategyHash, strategyHash(order));
});

test("full-range-fee compiles to the same bytes as the swapvm builder", () => {
	const r = rec([
		{
			templateId: "full-range-fee",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				fee: {
					instruction: "FLAT_FEE_AMOUNT_IN_XD",
					params: { feeBps: 3_000_000 },
				},
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1.5", "5000"],
		},
	]);
	const seed = deriveSaltSeed(r, null);
	const [got] = compileRecommendation(r, MAKER, seed);

	const program = fullRangeWithFee({
		salt: saltFor(seed, 0),
		deadline: 1_800_100_000,
		feeBps: 3_000_000,
	});
	const order = aquaOrder(MAKER, program);
	assert.equal(got.strategy, toHex(shipBytes(order)));
	assert.equal(got.strategyHash, strategyHash(order));
});

// The model's amounts are truncated to the token's decimals upstream, so extra
// fraction digits reaching compile are a bug — reject, never round.
test("toBaseUnits rejects amounts with more fraction digits than the token's decimals", () => {
	assert.throws(() => toBaseUnits("1.1234567", 6)); // USDC has 6dp, this has 7
});

test("compileRecommendation rejects over-precision virtualAmounts (USDC 6dp)", () => {
	const r = rec([
		{
			templateId: "full-range",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1", "1.1234567"],
		},
	]);
	assert.throws(() => compileRecommendation(r, MAKER, deriveSaltSeed(r, null)));
});

// The ENCLAVE path seeds from the signed text, not the recommendation JSON: two
// callers with the same rec but different signedText must never collide, and the
// seed must be deterministic and equal keccak256(signedText).
test("deriveSaltSeed uses the signed text (ENCLAVE branch), not the rec JSON", () => {
	const r = rec([
		{
			templateId: "full-range",
			slots: {
				curve: { instruction: "XYC_SWAP_XD" },
				deadline: { deadline: 1_800_100_000 },
			},
			tokens: [WETH, USDC],
			virtualAmounts: ["1", "3000"],
		},
	]);
	const signedText = "some-signed-text";
	const enclaveSeed = deriveSaltSeed(r, signedText);
	const jsonSeed = deriveSaltSeed(r, null);

	assert.equal(enclaveSeed, keccak256(toUtf8Bytes(signedText)));
	assert.notEqual(enclaveSeed, jsonSeed);
	assert.equal(deriveSaltSeed(r, signedText), enclaveSeed); // deterministic
});
