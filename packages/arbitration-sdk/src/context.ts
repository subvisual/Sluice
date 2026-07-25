// Stubbed market & book context.
//
// In the real system this comes from F3 (The Graph): live pair depth / realized
// vol / fee tier / recent volume, and the user's own shipped book, read at an
// observed block. That is out of scope here — per the agreed scope we hardcode
// a plausible snapshot so the composer has something to reason over. The shape
// mirrors what F3 will produce, so swapping this for a real `context()` call is
// a drop-in later.

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

export type PairContext = {
	pair: string;
	feeTierBps: number;
	poolDepthUsd: number;
	realizedVol7dPct: number;
	recentVolume24hUsd: number;
	midPrice: number; // token1 per token0, human units
};

export type BookPosition = {
	templateId: string;
	pair: string;
	note: string;
};

export type MarketContext = {
	observedAt: number;
	observedBlock: number;
	pair: PairContext;
	userBook: BookPosition[];
};

// A fixed, plausible snapshot. STUB — not live data.
export function stubContext(): MarketContext {
	return {
		// Fixed values (no Date.now / no chain read) so runs are reproducible.
		observedAt: 1750000000,
		observedBlock: 22_500_000,
		pair: {
			pair: "WETH/USDC",
			feeTierBps: 5,
			poolDepthUsd: 4_200_000,
			realizedVol7dPct: 58,
			recentVolume24hUsd: 31_000_000,
			midPrice: 3_450,
		},
		userBook: [
			{
				templateId: "T1",
				pair: "WETH/USDC",
				note: "existing tight-clmm position, ~40% filled",
			},
		],
	};
}

export function contextPromptBlock(ctx: MarketContext): string {
	const p = ctx.pair;
	const book =
		ctx.userBook.length === 0
			? "  (none)"
			: ctx.userBook
					.map((b) => `  - ${b.templateId} on ${b.pair}: ${b.note}`)
					.join("\n");
	return [
		`MARKET CONTEXT (stub, observed at block ${ctx.observedBlock}):`,
		`  pair ${p.pair} | mid ${p.midPrice} | feeTier ${p.feeTierBps}bps`,
		`  poolDepth $${p.poolDepthUsd.toLocaleString("en-US")} | realizedVol(7d) ${p.realizedVol7dPct}% | volume(24h) $${p.recentVolume24hUsd.toLocaleString("en-US")}`,
		`USER BOOK:`,
		book,
	].join("\n");
}
