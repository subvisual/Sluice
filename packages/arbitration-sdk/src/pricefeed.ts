// Real market mid from Chainlink USD feeds on Base (F3 job 2 — mid only).
//
// Reads run against REAL Base, never the pinned fork: the fork's feeds are
// frozen at the fork block, so a mid read off the fork is meaningless. This is
// read-only price data, so there is NO fork guard here — the guard stays scoped
// to signing (Wiring §0).
//
// The mid for a pair token0/token1 is usd(token0) / usd(token1) — "token1 per
// token0, human units", matching PairContext.midPrice. USDC/USDT ~ $1, but we
// read their feeds rather than assume exactly 1.

import { ethers } from "ethers";
import addresses from "../../../config/addresses.8453.json";

export const AGGREGATOR_V3_ABI = [
	"function decimals() view returns (uint8)",
	"function description() view returns (string)",
	"function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

export type FeedConfig = {
	feed: string;
	description: string;
	decimals: number;
};

const FEEDS = addresses.chainlinkFeeds as Record<string, FeedConfig>;

export function feedFor(symbol: string): FeedConfig {
	const key = Object.keys(FEEDS).find(
		(k) => k.toLowerCase() === symbol.toLowerCase(),
	);
	if (!key) throw new Error(`no Chainlink feed pinned for ${symbol}`);
	return FEEDS[key];
}

// Pure. mid = usd(token0) / usd(token1) = token1 per token0.
export function deriveMid(token0Usd: number, token1Usd: number): number {
	return token0Usd / token1Usd;
}

// Pure guard: the on-chain identity of a feed must match what we pinned, or we
// refuse to use its price (a wrong/swapped address fails loudly, never silently
// signs a bad mid).
export function assertFeedMatches(
	symbol: string,
	onchain: { description: string; decimals: number },
): void {
	const cfg = feedFor(symbol);
	if (onchain.description.trim() !== cfg.description.trim()) {
		throw new Error(
			`Chainlink feed for ${symbol}: on-chain description "${onchain.description}" != pinned "${cfg.description}"`,
		);
	}
	if (onchain.decimals !== cfg.decimals) {
		throw new Error(
			`Chainlink feed for ${symbol}: on-chain decimals ${onchain.decimals} != pinned ${cfg.decimals}`,
		);
	}
}

// Pure guard: a deprecated/broken aggregator can report a non-positive
// answer (0 or negative). Refuse it rather than let it flow into deriveMid
// and silently sign a 0/Infinity/negative mid.
export function assertLiveAnswer(symbol: string, answer: bigint): void {
	if (answer <= 0n) {
		throw new Error(
			`Chainlink feed for ${symbol}: non-positive answer ${answer}`,
		);
	}
}

export type FeedRead = {
	symbol: string;
	priceUsd: number;
	decimals: number;
	description: string;
	updatedAt: number;
};

// Network. Reads one AggregatorV3 USD feed and verifies its identity.
export async function readUsdFeed(
	symbol: string,
	provider: ethers.Provider,
): Promise<FeedRead> {
	const cfg = feedFor(symbol);
	const c = new ethers.Contract(cfg.feed, AGGREGATOR_V3_ABI, provider);
	const [decimalsRaw, description, round] = await Promise.all([
		c.decimals(),
		c.description(),
		c.latestRoundData(),
	]);
	const decimals = Number(decimalsRaw);
	assertFeedMatches(symbol, { description, decimals });
	// ethers v6 returns bigint for int256/uint256.
	const answer = round.answer as bigint;
	assertLiveAnswer(symbol, answer);
	const priceUsd = Number(answer) / 10 ** decimals;
	return {
		symbol,
		priceUsd,
		decimals,
		description,
		updatedAt: Number(round.updatedAt as bigint),
	};
}

export function baseRpcUrl(): string {
	return (
		process.env.SLUICE_BASE_RPC_URL?.trim() || "https://base-rpc.publicnode.com"
	);
}

export type MidRead = {
	mid: number;
	token0: FeedRead;
	token1: FeedRead;
	oldestUpdatedAt: number;
};

// Network. Real mid for token0/token1 from two Chainlink USD feeds on Base.
export async function fetchMid(
	token0: string,
	token1: string,
	opts: { provider?: ethers.Provider } = {},
): Promise<MidRead> {
	const provider = opts.provider ?? new ethers.JsonRpcProvider(baseRpcUrl());
	const [t0, t1] = await Promise.all([
		readUsdFeed(token0, provider),
		readUsdFeed(token1, provider),
	]);
	return {
		mid: deriveMid(t0.priceUsd, t1.priceUsd),
		token0: t0,
		token1: t1,
		oldestUpdatedAt: Math.min(t0.updatedAt, t1.updatedAt),
	};
}
