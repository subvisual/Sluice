import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatUnits,
	unwrap,
	shapeUserBook,
	shapeMakerPositions,
} from "./subgraph.ts";

// --- formatUnits: exact integer -> decimal string, no floating point ---

test("formatUnits divides by 10^decimals exactly", () => {
	assert.equal(formatUnits("5000000", 6), "5");
	assert.equal(formatUnits("8021190", 6), "8.02119");
	assert.equal(formatUnits("238866", 6), "0.238866");
	assert.equal(formatUnits("1000000000000000", 18), "0.001");
	assert.equal(formatUnits("7477515000000000000", 18), "7.477515");
});

test("formatUnits handles sub-unit amounts and zero", () => {
	assert.equal(formatUnits("1", 6), "0.000001");
	assert.equal(formatUnits("0", 6), "0");
	assert.equal(formatUnits("0", 18), "0");
});

test("formatUnits with 0 decimals is the integer itself", () => {
	assert.equal(formatUnits("1500000000000", 0), "1500000000000");
	assert.equal(formatUnits("42", 0), "42");
});

test("formatUnits strips only trailing fractional zeros, never significant ones", () => {
	assert.equal(formatUnits("1500000000000", 6), "1500000"); // trailing int zeros kept
	assert.equal(formatUnits("100000", 6), "0.1");
});

// --- unwrap: pure GraphQL envelope handling ---

test("unwrap returns data on success", () => {
	assert.deepEqual(unwrap<{ x: number }>({ data: { x: 1 } }), { x: 1 });
});

test("unwrap throws with the GraphQL error messages", () => {
	assert.throws(
		() => unwrap({ errors: [{ message: "bad field" }, { message: "boom" }] }),
		/bad field; boom/,
	);
});

test("unwrap throws on a missing data envelope", () => {
	assert.throws(() => unwrap({}), /no data/i);
});

// --- shapeUserBook: raw subgraph rows -> clean, human-readable book ---

const RAW = {
	maker: {
		id: "0x6878d79f988e7ecb537016b93bb77b4d680e1f01",
		liveStrategyCount: 6,
		strategyCount: 57,
		books: [
			{
				token: { id: "0xgho", symbol: "GHO", decimals: 18 },
				committedVirtual: "7477515000000000000",
				liveStrategyCount: 3,
			},
			{
				token: { id: "0xusdc", symbol: "USDC", decimals: 6 },
				committedVirtual: "8021190",
				liveStrategyCount: 3,
			},
		],
	},
	strategies: [
		{
			id: "0xstrat1",
			strategyHash: "0xhash1",
			app: { id: "0xapp" },
			fillCount: 0,
			balances: [
				{
					token: { id: "0xweth", symbol: "WETH", decimals: 18 },
					virtualBalance: "1000000000000000",
				},
				{
					token: { id: "0xusdc", symbol: "USDC", decimals: 6 },
					virtualBalance: "5000000",
				},
			],
		},
	],
	fills: [
		{
			id: "0xf1",
			taker: "0xtaker",
			tokenIn: { symbol: "USDC", decimals: 6 },
			tokenOut: { symbol: "USDT", decimals: 6 },
			amountIn: "1",
			amountOut: "1",
			ts: "1785000000",
			block: "49000000",
			strategy: { id: "0xstrat1" },
		},
	],
};

test("shapeUserBook maps committed books with exact human amounts", () => {
	const book = shapeUserBook("0x6878D79F988E7ecB537016B93bb77b4d680e1F01", RAW);
	assert.equal(book.maker, "0x6878d79f988e7ecb537016b93bb77b4d680e1f01"); // lowercased
	assert.equal(book.liveStrategyCount, 6);
	assert.equal(book.tokenBooks.length, 2);
	const gho = book.tokenBooks.find((b) => b.symbol === "GHO")!;
	assert.equal(gho.committedVirtual, "7477515000000000000"); // raw preserved
	assert.equal(gho.committedVirtualHuman, "7.477515");
	const usdc = book.tokenBooks.find((b) => b.symbol === "USDC")!;
	assert.equal(usdc.committedVirtualHuman, "8.02119");
});

test("shapeUserBook maps live strategies and their per-token balances", () => {
	const book = shapeUserBook("0x6878d79f988e7ecb537016b93bb77b4d680e1f01", RAW);
	assert.equal(book.liveStrategies.length, 1);
	const s = book.liveStrategies[0];
	assert.equal(s.strategyHash, "0xhash1");
	assert.equal(s.balances.length, 2);
	assert.equal(
		s.balances.find((b) => b.symbol === "WETH")!.virtualBalanceHuman,
		"0.001",
	);
	assert.equal(
		s.balances.find((b) => b.symbol === "USDC")!.virtualBalanceHuman,
		"5",
	);
});

test("shapeUserBook maps recent fills with human amounts", () => {
	const book = shapeUserBook("0x6878d79f988e7ecb537016b93bb77b4d680e1f01", RAW);
	assert.equal(book.recentFills.length, 1);
	const f = book.recentFills[0];
	assert.equal(f.tokenIn, "USDC");
	assert.equal(f.tokenOut, "USDT");
	assert.equal(f.amountInHuman, "0.000001");
	assert.equal(f.strategyId, "0xstrat1");
});

test("shapeUserBook returns an empty book for an unknown maker (null row)", () => {
	const book = shapeUserBook("0xabc", {
		maker: null,
		strategies: [],
		fills: [],
	});
	assert.equal(book.liveStrategyCount, 0);
	assert.equal(book.strategyCount, 0);
	assert.deepEqual(book.tokenBooks, []);
	assert.deepEqual(book.liveStrategies, []);
	assert.deepEqual(book.recentFills, []);
});

test("shapeUserBook tolerates a token with null decimals (non-standard ERC20)", () => {
	const book = shapeUserBook("0xabc", {
		maker: {
			id: "0xabc",
			liveStrategyCount: 1,
			strategyCount: 1,
			books: [
				{
					token: { id: "0xweird", symbol: null, decimals: null },
					committedVirtual: "123",
					liveStrategyCount: 1,
				},
			],
		},
		strategies: [],
		fills: [],
	});
	const b = book.tokenBooks[0];
	assert.equal(b.decimals, null);
	assert.equal(b.committedVirtual, "123"); // raw kept
	assert.equal(b.committedVirtualHuman, "123"); // no scaling when decimals unknown
});

// --- shapeMakerPositions: dashboard rows, any status ---

const RAW_POSITIONS = {
	strategies: [
		{
			id: "0xmaker-app-hash1",
			strategyHash: "0xhash1",
			status: "LIVE",
			strategyData: "0xdeadbeef",
			shippedAt: "1750000000",
			dockedAt: null,
			balances: [
				{
					token: { id: "0xusdc", symbol: "USDC", decimals: 6 },
					initialVirtual: "5000000000",
					virtualBalance: "3795500000",
					totalPulled: "1204500000",
					totalPushed: "0",
				},
			],
			fills: [
				{
					ts: "1750001000",
					amountIn: "1204500000",
					amountOut: "490000000000000000",
					tokenIn: { symbol: "USDC", decimals: 6 },
					tokenOut: { symbol: "WETH", decimals: 18 },
				},
			],
		},
		{
			id: "0xmaker-app-hash2",
			strategyHash: "0xhash2",
			status: "DOCKED",
			strategyData: "0x",
			shippedAt: "1749000000",
			dockedAt: "1749500000",
			balances: [],
			fills: [],
		},
	],
};

test("shapeMakerPositions keeps every status and the raw strategy bytes", () => {
	const rows = shapeMakerPositions(RAW_POSITIONS);
	assert.equal(rows.length, 2);
	assert.equal(rows[0].status, "LIVE");
	assert.equal(rows[0].strategyData, "0xdeadbeef");
	assert.equal(rows[0].dockedAt, null);
	assert.equal(rows[0].shippedAt, 1750000000);
	assert.equal(rows[1].status, "DOCKED");
	assert.equal(rows[1].dockedAt, 1749500000);
});

test("shapeMakerPositions shapes balances and fills with raw base units", () => {
	const [row] = shapeMakerPositions(RAW_POSITIONS);
	assert.deepEqual(row.balances, [
		{
			tokenAddress: "0xusdc",
			symbol: "USDC",
			decimals: 6,
			initialVirtual: "5000000000",
			virtualBalance: "3795500000",
			totalPulled: "1204500000",
			totalPushed: "0",
		},
	]);
	assert.deepEqual(row.fills, [
		{
			ts: 1750001000,
			tokenInSymbol: "USDC",
			tokenInDecimals: 6,
			amountIn: "1204500000",
			tokenOutSymbol: "WETH",
			tokenOutDecimals: 18,
			amountOut: "490000000000000000",
		},
	]);
});

test("shapeMakerPositions yields an empty list for an unknown maker", () => {
	assert.deepEqual(shapeMakerPositions({ strategies: [] }), []);
	assert.deepEqual(shapeMakerPositions({}), []);
});
