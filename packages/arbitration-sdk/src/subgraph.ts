// F3 job 1 — the user's own book, read from the Aqua subgraph.
//
// This is the client that turns indexed Aqua activity into the shape F2's
// composer consumes as MarketContext.userBook (see context.ts). It answers
// "what has this maker already shipped" — committed per-token balances, live
// strategies, recent fills — for a given maker address.
//
// SCOPE: job 1 only. Job 2 (market: pool depth, realised vol) comes from
// composed hosted DEX/price subgraphs, not ours, and is blocked on F3 Open Q2
// (which price subgraph). The Recommendation/Template join (Notion F3 §3) is
// not in the deployed schema yet — it needs our RecommendationRegistry, which
// is deferred with F2 verifiability.
//
// Endpoint is a CONFIG value, never a code assumption (F3 §2): defaults to the
// deployed Studio Base subgraph and swaps to the local fork graph-node via
// SLUICE_SUBGRAPH_URL. No fork-only behaviour may leak in here.

// Deployed Graph Studio endpoint for the generic Aqua subgraph on Base
// (subgraph/README.md §7, v0.1.2). Real protocol data, no local stack needed.
export const DEFAULT_BASE_SUBGRAPH =
	"https://api.studio.thegraph.com/query/1756952/aqua-base/version/latest";

// The local self-hosted graph-node against an anvil Base fork (subgraph/local,
// `make fork-up`). Only this one sees positions WE ship on the fork.
export const LOCAL_FORK_SUBGRAPH =
	"http://localhost:8000/subgraphs/name/sluice/aqua-local";

// Resolve the endpoint: SLUICE_SUBGRAPH_URL overrides, else deployed Base.
export function subgraphUrl(): string {
	return process.env.SLUICE_SUBGRAPH_URL?.trim() || DEFAULT_BASE_SUBGRAPH;
}

// ---------------------------------------------------------------------------
// Pure helpers (no network) — the tested core.
// ---------------------------------------------------------------------------

// Exact integer-string -> decimal-string conversion. BigInt-based so token
// amounts never touch floating point (a raw uint256 through Number is a silent
// correctness bug). `decimals === null` means we don't know the token's scale,
// so we return the raw value unscaled rather than guess.
export function formatUnits(raw: string, decimals: number | null): string {
	if (decimals == null) return raw;
	const neg = raw.startsWith("-");
	const digits = (neg ? raw.slice(1) : raw).replace(/^0+(?=\d)/, "");
	if (decimals === 0) return (neg ? "-" : "") + digits;
	const padded = digits.padStart(decimals + 1, "0");
	const cut = padded.length - decimals;
	const intPart = padded.slice(0, cut);
	const frac = padded.slice(cut).replace(/0+$/, "");
	return (neg ? "-" : "") + intPart + (frac ? "." + frac : "");
}

// Unwrap a GraphQL HTTP response body: throw on `errors`, else return `data`.
export function unwrap<T>(json: any, label = "subgraph"): T {
	if (Array.isArray(json?.errors) && json.errors.length > 0) {
		const msg = json.errors.map((e: any) => e?.message ?? String(e)).join("; ");
		throw new Error(`${label} GraphQL error: ${msg}`);
	}
	if (json?.data == null) {
		throw new Error(`${label}: no data in response`);
	}
	return json.data as T;
}

// ---------------------------------------------------------------------------
// Shaped types — what a consumer (context.ts, the CLI) actually wants.
// ---------------------------------------------------------------------------

export type TokenBook = {
	tokenAddress: string;
	symbol: string | null;
	decimals: number | null;
	committedVirtual: string; // raw integer string (base units)
	committedVirtualHuman: string; // scaled by decimals
	liveStrategyCount: number;
};

export type StrategyBalance = {
	tokenAddress: string;
	symbol: string | null;
	decimals: number | null;
	virtualBalance: string;
	virtualBalanceHuman: string;
};

export type LiveStrategy = {
	id: string;
	strategyHash: string;
	app: string;
	fillCount: number;
	balances: StrategyBalance[];
};

export type RecentFill = {
	id: string;
	taker: string;
	tokenIn: string | null;
	tokenOut: string | null;
	amountIn: string;
	amountInHuman: string;
	amountOut: string;
	amountOutHuman: string;
	ts: number;
	block: number;
	strategyId: string | null;
};

export type UserBook = {
	maker: string;
	strategyCount: number;
	liveStrategyCount: number;
	tokenBooks: TokenBook[];
	liveStrategies: LiveStrategy[];
	recentFills: RecentFill[];
};

// Map raw subgraph rows into a clean, human-readable UserBook. Pure: no
// network, no clock. A null `maker` row (unknown / never-active address) yields
// an empty-but-valid book rather than throwing.
export function shapeUserBook(maker: string, data: any): UserBook {
	const m = maker.toLowerCase();
	const raw = data?.maker ?? null;

	const tokenBooks: TokenBook[] = (raw?.books ?? []).map((b: any) => ({
		tokenAddress: b.token?.id ?? "",
		symbol: b.token?.symbol ?? null,
		decimals: b.token?.decimals ?? null,
		committedVirtual: b.committedVirtual,
		committedVirtualHuman: formatUnits(
			b.committedVirtual,
			b.token?.decimals ?? null,
		),
		liveStrategyCount: b.liveStrategyCount,
	}));

	const liveStrategies: LiveStrategy[] = (data?.strategies ?? []).map(
		(s: any) => ({
			id: s.id,
			strategyHash: s.strategyHash,
			app: s.app?.id ?? "",
			fillCount: s.fillCount ?? 0,
			balances: (s.balances ?? []).map((bal: any) => ({
				tokenAddress: bal.token?.id ?? "",
				symbol: bal.token?.symbol ?? null,
				decimals: bal.token?.decimals ?? null,
				virtualBalance: bal.virtualBalance,
				virtualBalanceHuman: formatUnits(
					bal.virtualBalance,
					bal.token?.decimals ?? null,
				),
			})),
		}),
	);

	const recentFills: RecentFill[] = (data?.fills ?? []).map((f: any) => ({
		id: f.id,
		taker: f.taker,
		tokenIn: f.tokenIn?.symbol ?? null,
		tokenOut: f.tokenOut?.symbol ?? null,
		amountIn: f.amountIn,
		amountInHuman: formatUnits(f.amountIn, f.tokenIn?.decimals ?? null),
		amountOut: f.amountOut,
		amountOutHuman: formatUnits(f.amountOut, f.tokenOut?.decimals ?? null),
		ts: Number(f.ts),
		block: Number(f.block),
		strategyId: f.strategy?.id ?? null,
	}));

	return {
		maker: m,
		strategyCount: raw?.strategyCount ?? 0,
		liveStrategyCount: raw?.liveStrategyCount ?? 0,
		tokenBooks,
		liveStrategies,
		recentFills,
	};
}

// ---------------------------------------------------------------------------
// Network boundary — thin; the shaping above is where the logic lives.
// ---------------------------------------------------------------------------

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function post(url: string, query: string): Promise<any> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ query }),
	});
	if (!res.ok) {
		throw new Error(`subgraph HTTP ${res.status} ${res.statusText} @ ${url}`);
	}
	return res.json();
}

export type SubgraphMeta = {
	block: number;
	timestamp: number | null;
	deployment: string;
	hasIndexingErrors: boolean;
};

// Health probe — confirms the endpoint answers and reports its indexed head.
export async function fetchMeta(url = subgraphUrl()): Promise<SubgraphMeta> {
	const json = await post(
		url,
		`{ _meta { block { number timestamp } deployment hasIndexingErrors } }`,
	);
	const data = unwrap<any>(json, "meta");
	return {
		block: Number(data._meta.block.number),
		timestamp:
			data._meta.block.timestamp != null
				? Number(data._meta.block.timestamp)
				: null,
		deployment: data._meta.deployment,
		hasIndexingErrors: data._meta.hasIndexingErrors,
	};
}

function bookQuery(maker: string): string {
	const m = maker.toLowerCase();
	return `{
    maker(id: "${m}") {
      id liveStrategyCount strategyCount
      books { token { id symbol decimals } committedVirtual liveStrategyCount }
    }
    strategies(where: { maker: "${m}", status: LIVE }, orderBy: shippedAt, orderDirection: desc, first: 100) {
      id strategyHash app { id } fillCount
      balances { token { id symbol decimals } virtualBalance }
    }
    fills(where: { maker: "${m}" }, orderBy: ts, orderDirection: desc, first: 20) {
      id taker tokenIn { symbol decimals } tokenOut { symbol decimals } amountIn amountOut ts block strategy { id }
    }
  }`;
}

// Fetch and shape a maker's book from the subgraph at `url`.
export async function fetchUserBook(
	maker: string,
	url = subgraphUrl(),
): Promise<UserBook> {
	if (!ADDRESS.test(maker)) {
		throw new Error(`not a valid address: "${maker}"`);
	}
	const json = await post(url, bookQuery(maker));
	const data = unwrap<any>(json, "book");
	return shapeUserBook(maker, data);
}
