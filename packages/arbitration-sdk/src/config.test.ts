// The address book is the ONE place a chain-specific value lives (F1 §1), and
// it has three sections that describe the same tokens three ways: `tokens`
// (flat, parsed by Forge), `tokenList` (display metadata for the app's picker)
// and `chainlinkFeeds` (the USD feed each mid is derived from). Nothing at
// runtime cross-checks them, so a token added to one section and forgotten in
// the others presents as a picker row that cannot compile, or a pair with no
// mid. These tests are that cross-check.
import test from "node:test";
import assert from "node:assert/strict";
import addresses from "../../../config/addresses.8453.json";

const flatTokens = addresses.tokens as Record<string, string>;

test("tokens, tokenList and chainlinkFeeds describe exactly the same symbols", () => {
	const tokens = Object.keys(flatTokens).sort();
	const list = addresses.tokenList.map((t) => t.symbol).sort();
	const feeds = Object.keys(addresses.chainlinkFeeds).sort();

	assert.deepEqual(list, tokens, "tokenList and tokens disagree");
	assert.deepEqual(list, feeds, "tokenList and chainlinkFeeds disagree");
});

test("every tokenList address matches the flat tokens map", () => {
	for (const t of addresses.tokenList) {
		assert.equal(
			t.address.toLowerCase(),
			flatTokens[t.symbol].toLowerCase(),
			`${t.symbol}: address disagrees between tokens and tokenList`,
		);
	}
});

test("every tokenList entry carries display metadata the picker can render", () => {
	for (const t of addresses.tokenList) {
		assert.ok(t.name.length > 0, `${t.symbol} has no name`);
		assert.ok(
			Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 18,
			`${t.symbol} has implausible decimals ${t.decimals}`,
		);
	}
});

test("the five tokens the picker offers are all present", () => {
	const list = addresses.tokenList.map((t) => t.symbol).sort();
	assert.deepEqual(list, ["USDC", "USDT", "USDe", "WETH", "cbBTC"]);
});
