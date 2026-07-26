// Market & book context the composer reasons over (F3).
//
// Two jobs land in one MarketContext (F3 §1):
//   - Job 1, the user's OWN book — what they've already shipped. This is now
//     REAL: read from the Aqua subgraph (see subgraph.ts) via liveContext().
//   - Job 2, the MARKET — now PARTIAL real: midPrice is live, read from
//     Chainlink USD feeds on real Base (see pricefeed.ts). Depth, realised
//     vol, fee tier, and volume are still stubbed — they come from composed
//     hosted DEX/price subgraphs and are blocked on F3 Open Q2 (which price
//     subgraph). Labelled per-field via pairFieldSource so nothing downstream
//     — or on stage — mistakes a stub field for live data.
//
// `source` records which it is, and contextPromptBlock() renders that honesty
// straight into the prompt the enclave signs.

import { fetchMid } from "./pricefeed.ts";
import {
	fetchMeta,
	fetchUserBook,
	subgraphUrl,
	type UserBook,
} from "./subgraph.ts";
import addresses from "../../../config/addresses.8453.json";

export type TokenInfo = { symbol: string; address: string; decimals: number };

// The token map, from the ONE address book (F1 §1). This used to be a hardcoded
// WETH+USDC literal, which compile.ts derives decimals from — so a budget token
// outside it threw at compile time even though the picker offered it.
// Keyed by exact symbol so TOKENS.USDC keeps resolving; look up by user input
// through tokenBySymbol, never by indexing directly.
export const TOKENS: Record<string, TokenInfo> = Object.fromEntries(
	addresses.tokenList.map((t) => [
		t.symbol,
		{ symbol: t.symbol, address: t.address, decimals: t.decimals },
	]),
);

// Case-insensitive: symbols are mixed-case (USDe, cbBTC), so keying on
// symbol.toUpperCase() silently finds nothing for exactly the tokens whose
// symbols are not all-caps. Mirrors pricefeed.ts's feedFor.
export function tokenBySymbol(symbol: string): TokenInfo | undefined {
	const key = Object.keys(TOKENS).find(
		(k) => k.toLowerCase() === symbol.toLowerCase(),
	);
	return key ? TOKENS[key] : undefined;
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

// Per-field liveness for the market pair (job 2). Only the MARKET-DATA fields
// carry a source — the `pair` NAME string does not. This is the job-2 analogue
// of MarketContext.source (which labels the book, job 1).
export type PairDataField =
	| "feeTierBps"
	| "poolDepthUsd"
	| "realizedVol7dPct"
	| "recentVolume24hUsd"
	| "midPrice";
export type PairFieldSource = "chainlink" | "stub" | "deferred";
export type PairLiveness = Record<PairDataField, PairFieldSource>;

const ALL_STUB_LIVENESS: PairLiveness = {
	feeTierBps: "stub",
	poolDepthUsd: "stub",
	realizedVol7dPct: "stub",
	recentVolume24hUsd: "stub",
	midPrice: "stub",
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
	pairFieldSource: PairLiveness; // job 2 — per-field live/stub, keyed to `pair`
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

// Build a real PairContext: real mid from Chainlink, the rest still stub (mid
// only, this pass). Network — reads real Base. The non-mid fields keep the
// STUB_PAIR values and are labelled "stub" so nothing reads them as live.
export async function fetchPairContext(
	token0: string,
	token1: string,
	opts: { provider?: import("ethers").Provider } = {},
): Promise<{
	pair: PairContext;
	pairFieldSource: PairLiveness;
	oldestFeedUpdatedAt: number;
}> {
	const midRead = await fetchMid(token0, token1, opts);
	return {
		pair: {
			...STUB_PAIR,
			pair: `${token0}/${token1}`,
			midPrice: midRead.mid,
		},
		pairFieldSource: { ...ALL_STUB_LIVENESS, midPrice: "chainlink" },
		oldestFeedUpdatedAt: midRead.oldestUpdatedAt,
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
		pairFieldSource: ALL_STUB_LIVENESS,
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
	opts: {
		url?: string;
		pair?: PairContext;
		pairFieldSource?: PairLiveness;
		pairTokens?: [string, string];
	} = {},
): Promise<MarketContext> {
	const url = opts.url ?? subgraphUrl();
	const [meta, book] = await Promise.all([
		fetchMeta(url),
		fetchUserBook(maker, url),
	]);

	// The pair (job 2). An injected pair wins (tests / offline). Otherwise fetch
	// the real mid from Chainlink; a price-read failure degrades to a labelled
	// stub pair — it must NOT sink the (real) book we just read.
	let pair = opts.pair ?? STUB_PAIR;
	let pairFieldSource = opts.pairFieldSource ?? ALL_STUB_LIVENESS;
	if (!opts.pair) {
		try {
			const [t0, t1] = opts.pairTokens ?? ["WETH", "USDC"];
			const fetched = await fetchPairContext(t0, t1);
			pair = fetched.pair;
			pairFieldSource = fetched.pairFieldSource;
		} catch {
			// keep the stub pair + all-stub labels: honest degrade, not a crash.
		}
	}

	return {
		// A _meta without a timestamp must not anchor time at 0: the prompt
		// derives "now" and the deadline window from observedAt, so a zero here
		// asks the model for deadlines in 1970. Wall clock is the honest
		// fallback — this function is already a live network read.
		observedAt: meta.timestamp ?? Math.floor(Date.now() / 1000),
		observedBlock: meta.block,
		source: "subgraph",
		pair,
		pairFieldSource,
		userBook: bookToContext(book),
	};
}

export function contextPromptBlock(ctx: MarketContext): string {
	const p = ctx.pair;
	const src = ctx.pairFieldSource;
	const tag = (f: PairDataField): string =>
		src[f] === "chainlink"
			? "LIVE"
			: src[f] === "deferred"
				? "DEFERRED"
				: "STUB";
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
		`MARKET CONTEXT (per-field liveness tagged; observed at block ${ctx.observedBlock}):`,
		`  pair ${p.pair} | mid ${p.midPrice} [${tag("midPrice")}] | feeTier ${p.feeTierBps}bps [${tag("feeTierBps")}]`,
		`  poolDepth $${p.poolDepthUsd.toLocaleString("en-US")} [${tag("poolDepthUsd")}] | realizedVol(7d) ${p.realizedVol7dPct}% [${tag("realizedVol7dPct")}] | volume(24h) $${p.recentVolume24hUsd.toLocaleString("en-US")} [${tag("recentVolume24hUsd")}]`,
		bookHeader,
		`  live strategies: ${ctx.userBook.liveStrategyCount} (of ${ctx.userBook.strategyCount} total)`,
		committed,
		`  recent fills: ${ctx.userBook.recentFillCount}`,
	].join("\n");
}
