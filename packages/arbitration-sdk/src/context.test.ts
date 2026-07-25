import { test } from "node:test";
import assert from "node:assert/strict";
import { bookToContext, contextPromptBlock, stubContext } from "./context.ts";
import type { UserBook } from "./subgraph.ts";

const BOOK: UserBook = {
	maker: "0x471e8aad77a1a29335081850b4e34fa7863f762a",
	strategyCount: 24,
	liveStrategyCount: 24,
	tokenBooks: [
		{
			tokenAddress: "0xusdc",
			symbol: "USDC",
			decimals: 6,
			committedVirtual: "238866",
			committedVirtualHuman: "0.238866",
			liveStrategyCount: 24,
		},
		{
			tokenAddress: "0xusdt",
			symbol: "USDT",
			decimals: 6,
			committedVirtual: "240866",
			committedVirtualHuman: "0.240866",
			liveStrategyCount: 24,
		},
	],
	liveStrategies: [],
	recentFills: [
		{
			id: "0xf1",
			taker: "0xt",
			tokenIn: "USDC",
			tokenOut: "USDT",
			amountIn: "1",
			amountInHuman: "0.000001",
			amountOut: "1",
			amountOutHuman: "0.000001",
			ts: 1,
			block: 2,
			strategyId: "0xs",
		},
	],
};

test("bookToContext distils a subgraph book into the compact prompt shape", () => {
	const uc = bookToContext(BOOK);
	assert.equal(uc.maker, "0x471e8aad77a1a29335081850b4e34fa7863f762a");
	assert.equal(uc.liveStrategyCount, 24);
	assert.equal(uc.strategyCount, 24);
	assert.equal(uc.committed.length, 2);
	assert.deepEqual(uc.committed[0], {
		symbol: "USDC",
		committedHuman: "0.238866",
		liveStrategyCount: 24,
	});
	assert.equal(uc.recentFillCount, 1);
});

test("bookToContext falls back to the token address when a symbol is missing", () => {
	const uc = bookToContext({
		...BOOK,
		tokenBooks: [
			{
				tokenAddress: "0xweird",
				symbol: null,
				decimals: null,
				committedVirtual: "5",
				committedVirtualHuman: "5",
				liveStrategyCount: 1,
			},
		],
	});
	assert.equal(uc.committed[0].symbol, "0xweird");
});

test("contextPromptBlock renders the real book and labels it live", () => {
	const ctx = {
		observedAt: 1785000000,
		observedBlock: 49_000_000,
		source: "subgraph" as const,
		pair: stubContext().pair,
		userBook: bookToContext(BOOK),
	};
	const block = contextPromptBlock(ctx);
	assert.match(block, /USER BOOK \(live from subgraph @ block 49000000/);
	assert.match(block, /maker 0x471e8aad/);
	assert.match(block, /USDC: 0\.238866 committed across 24 live/);
	assert.match(block, /recent fills: 1/);
	// The market half must still announce itself as a stub (honesty rule).
	assert.match(block, /pair data is a STUB/);
});

test("contextPromptBlock marks the stub book as a stub", () => {
	const block = contextPromptBlock(stubContext());
	assert.match(block, /USER BOOK \(stub\)/);
	assert.match(block, /pair data is a STUB/);
});

test("contextPromptBlock handles an empty book", () => {
	const ctx = {
		observedAt: 0,
		observedBlock: 1,
		source: "subgraph" as const,
		pair: stubContext().pair,
		userBook: {
			maker: "0xabc",
			strategyCount: 0,
			liveStrategyCount: 0,
			committed: [],
			recentFillCount: 0,
		},
	};
	assert.match(contextPromptBlock(ctx), /empty — no live positions/);
});
