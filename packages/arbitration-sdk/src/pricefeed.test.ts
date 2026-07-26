import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFeedMatches, deriveMid, feedFor } from "./pricefeed.ts";

test("deriveMid returns token1 per token0 (usd0 / usd1)", () => {
	assert.equal(deriveMid(1878.18, 0.9999), 1878.18 / 0.9999);
});

test("deriveMid on a stable/stable pair is ~1", () => {
	assert.ok(Math.abs(deriveMid(0.9999, 0.9991) - 1) < 0.01);
});

test("feedFor resolves every pinned symbol, case-insensitively", () => {
	for (const s of ["WETH", "cbbtc", "USDC", "usdt"]) {
		assert.match(feedFor(s).feed, /^0x[0-9a-fA-F]{40}$/);
	}
});

test("feedFor throws for an unpinned symbol", () => {
	assert.throws(() => feedFor("DOGE"), /no Chainlink feed/);
});

test("assertFeedMatches passes on an exact match", () => {
	assert.doesNotThrow(() =>
		assertFeedMatches("WETH", { description: "ETH / USD", decimals: 8 }),
	);
});

test("assertFeedMatches throws on a description mismatch", () => {
	assert.throws(
		() => assertFeedMatches("WETH", { description: "BTC / USD", decimals: 8 }),
		/WETH/,
	);
});

test("assertFeedMatches throws on a decimals mismatch", () => {
	assert.throws(
		() => assertFeedMatches("WETH", { description: "ETH / USD", decimals: 18 }),
		/WETH/,
	);
});
