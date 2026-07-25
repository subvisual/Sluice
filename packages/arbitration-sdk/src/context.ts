// Market & book context the composer reasons over (F3).
//
// Two jobs land in one MarketContext (F3 §1):
//   - Job 1, the user's OWN book — what they've already shipped. This is now
//     REAL: read from the Aqua subgraph (see subgraph.ts) via liveContext().
//   - Job 2, the MARKET — pool depth, realised vol, fee tier. Still a STUB:
//     it comes from composed hosted DEX/price subgraphs and is blocked on F3
//     Open Q2 (which price subgraph). Labelled as a stub end-to-end so nothing
//     downstream — or on stage — mistakes it for live data.
//
// `source` records which it is, and contextPromptBlock() renders that honesty
// straight into the prompt the enclave signs.

import {
	fetchMeta,
	fetchUserBook,
	subgraphUrl,
	type UserBook,
} from "./subgraph.ts";

export type TokenInfo = { symbol: string; address: string; decimals: number };

// Base mainnet token addresses (from config/addresses.8453.json).
export const TOKENS: Record<string, TokenInfo> = {
	USDC: {
		symbol: "USDC",
		address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
		decimals: 6,
	},
	WETH: {
		symbol: "WETH",
		address: "0x4200000000000000000000000000000000000006",
		decimals: 18,
	},
};

export function tokenBySymbol(symbol: string): TokenInfo | undefined {
	return TOKENS[symbol.toUpperCase()];
}

// Job 2 — the market. STILL A STUB (F3 Open Q2).
export type PairContext = {
	pair: string;
	feeTierBps: number;
	poolDepthUsd: number;
	realizedVol7dPct: number;
	recentVolume24hUsd: number;
	midPrice: number; // token1 per token0, human units
};

// Job 1 — the user's own book, distilled for the prompt.
export type UserTokenCommit = {
	symbol: string; // or address, if the token has no symbol
	committedHuman: string; // committed virtual balance, human units
	liveStrategyCount: number;
};

export type UserBookContext = {
	maker: string | null; // null for the stub
	strategyCount: number;
	liveStrategyCount: number;
	committed: UserTokenCommit[];
	recentFillCount: number;
};

export type MarketContext = {
	observedAt: number;
	observedBlock: number;
	source: "stub" | "subgraph"; // where the BOOK came from (job 1)
	pair: PairContext; // job 2 — always a stub for now
	userBook: UserBookContext; // job 1 — real when source === "subgraph"
};

// The stub market. Plausible WETH/USDC numbers; NOT live (F3 job 2 / Open Q2).
const STUB_PAIR: PairContext = {
	pair: "WETH/USDC",
	feeTierBps: 5,
	poolDepthUsd: 4_200_000,
	realizedVol7dPct: 58,
	recentVolume24hUsd: 31_000_000,
	midPrice: 3_450,
};

// Distil a full subgraph UserBook into the compact book the prompt needs. Pure.
export function bookToContext(book: UserBook): UserBookContext {
	return {
		maker: book.maker,
		strategyCount: book.strategyCount,
		liveStrategyCount: book.liveStrategyCount,
		committed: book.tokenBooks.map((b) => ({
			symbol: b.symbol ?? b.tokenAddress,
			committedHuman: b.committedVirtualHuman,
			liveStrategyCount: b.liveStrategyCount,
		})),
		recentFillCount: book.recentFills.length,
	};
}

// A fixed, plausible snapshot. STUB — market AND book are hardcoded. Kept for
// tests and for `compose` runs without a maker address.
export function stubContext(): MarketContext {
	return {
		// Fixed values (no Date.now / no chain read) so runs are reproducible.
		observedAt: 1750000000,
		observedBlock: 22_500_000,
		source: "stub",
		pair: STUB_PAIR,
		userBook: {
			maker: null,
			strategyCount: 1,
			liveStrategyCount: 1,
			committed: [
				{ symbol: "WETH", committedHuman: "0.5", liveStrategyCount: 1 },
			],
			recentFillCount: 0,
		},
	};
}

// Build a MarketContext with a REAL book (job 1) read from the subgraph, keyed
// to the subgraph's indexed head block. The market (job 2) stays a stub until
// F3 Open Q2 settles the price source. Network call — used by the CLI, not the
// unit tests.
export async function liveContext(
	maker: string,
	opts: { url?: string; pair?: PairContext } = {},
): Promise<MarketContext> {
	const url = opts.url ?? subgraphUrl();
	const [meta, book] = await Promise.all([
		fetchMeta(url),
		fetchUserBook(maker, url),
	]);
	return {
		// A _meta without a timestamp must not anchor time at 0: the prompt
		// derives "now" and the deadline window from observedAt, so a zero here
		// asks the model for deadlines in 1970. Wall clock is the honest
		// fallback — this function is already a live network read.
		observedAt: meta.timestamp ?? Math.floor(Date.now() / 1000),
		observedBlock: meta.block,
		source: "subgraph",
		pair: opts.pair ?? STUB_PAIR,
		userBook: bookToContext(book),
	};
}

export function contextPromptBlock(ctx: MarketContext): string {
	const p = ctx.pair;
	const bookHeader =
		ctx.source === "subgraph"
			? `USER BOOK (live from subgraph @ block ${ctx.observedBlock}${ctx.userBook.maker ? `, maker ${ctx.userBook.maker}` : ""}):`
			: `USER BOOK (stub):`;
	const committed =
		ctx.userBook.committed.length === 0
			? "  (empty — no live positions)"
			: ctx.userBook.committed
					.map(
						(c) =>
							`  - ${c.symbol}: ${c.committedHuman} committed across ${c.liveStrategyCount} live strategies`,
					)
					.join("\n");
	return [
		`MARKET CONTEXT — pair data is a STUB (F3 job 2 / Open Q2, not live), observed at block ${ctx.observedBlock}:`,
		`  pair ${p.pair} | mid ${p.midPrice} | feeTier ${p.feeTierBps}bps`,
		`  poolDepth $${p.poolDepthUsd.toLocaleString("en-US")} | realizedVol(7d) ${p.realizedVol7dPct}% | volume(24h) $${p.recentVolume24hUsd.toLocaleString("en-US")}`,
		bookHeader,
		`  live strategies: ${ctx.userBook.liveStrategyCount} (of ${ctx.userBook.strategyCount} total)`,
		committed,
		`  recent fills: ${ctx.userBook.recentFillCount}`,
	].join("\n");
}
