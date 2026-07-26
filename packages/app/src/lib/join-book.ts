import type { Address, Hex } from "viem";
import type {
  LiveStrategy,
  RecentFill,
  StrategyBalance,
  UserBook,
} from "@sluice/arbitration-sdk/subgraph";
import type {
  Fill,
  Position,
  PositionLeg,
  Provenance,
  RiskRating,
  SlotRow,
} from "./book";
import { formatDayShort } from "./time";
import { tokenBy } from "./tokens";

/**
 * The pure JOIN: on-chain book (subgraph) + locally-cached ship-time metadata
 * → the `Position[]` the dashboard renders. No fetch, no React, no clock other
 * than what is passed in — everything here is a plain function of its inputs,
 * which is what makes it unit-testable without a chain or a subgraph.
 *
 * `strategyHash` is the join key (Wiring §10, spec Slice B): the subgraph
 * knows the current committed balance and fills for a live strategy, the
 * cache knows what was originally recommended (template, band, deadline,
 * risk, slots, the ceiling per leg). Neither side alone is a Position.
 */

/** One leg's ceiling as recorded at ship time — no `consumed`, that is derived. */
export type CachedLeg = {
  token: Address;
  symbol: string;
  decimals: number;
  virtual: bigint;
};

/** Everything about a strategy that ship time knows and the subgraph does not. */
export type CachedStrategyMeta = {
  pair: string;
  templateLabel: string;
  description: string;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  legs: CachedLeg[];
  deadline: number;
  risk: RiskRating | null;
  provenance: Provenance;
  slots: SlotRow[];
};

/** Keyed by the real, on-chain `strategyHash` — the only stable join key. */
export type StrategyCache = Record<Hex, CachedStrategyMeta>;

// A live strategy with no cache match still needs *some* deadline so
// `positionStatus()` (which infers Live/Expired purely from `deadline` vs
// `dockedAt`) reads it as Live. The subgraph's own `status: LIVE` filter is
// the true signal here — we are only missing the strategy's original
// deadline, not evidence that it has expired — so pin far enough out that the
// derived status never disagrees with the query that produced this row.
const UNKNOWN_DEADLINE_SECONDS = 100 * 365 * 86_400;

/**
 * Join a fetched book against the local cache. `book === null` (subgraph
 * unavailable) stays `null` — never collapse it into `[]`, the dashboard
 * renders those two completely differently (Wiring §10).
 */
export function joinBook(
  book: UserBook | null,
  cache: StrategyCache,
): Position[] | null {
  if (book === null) return null;
  return book.liveStrategies.map((ls) =>
    toPosition(ls, cache[ls.strategyHash as Hex], fillsFor(ls, book.recentFills)),
  );
}

/** One `LiveStrategy` row → one `Position`, with or without a cache match. */
export function toPosition(
  ls: LiveStrategy,
  cached: CachedStrategyMeta | undefined,
  fills: Fill[],
): Position {
  const hash = ls.strategyHash as Hex;

  if (cached) {
    const base = positionFromMeta(hash, cached, fills);
    return { ...base, legs: joinLegs(cached.legs, ls.balances) };
  }

  // No local record — shipped from another browser, before this app cached
  // metadata, or the cache was cleared. Render what the chain alone can
  // prove: the pair implied by the tokens still committed, the balances
  // themselves, and the fills. Never invent a risk rating or slot content we
  // do not have.
  const legs = reducedLegs(ls.balances);
  return {
    id: hash,
    strategyHash: hash,
    pair: pairFromTokens(legs),
    templateLabel: "Aqua strategy",
    description:
      "Shipped strategy with no locally recorded metadata — this browser never composed it, so only the current committed balance is known.",
    bandKind: "band",
    band: "—",
    bandNote: "terms not recorded locally",
    legs,
    fills,
    deadline: Math.floor(Date.now() / 1000) + UNKNOWN_DEADLINE_SECONDS,
    dockedAt: null,
    risk: null,
    // Neither value is literally true (we have no signature to check either
    // way); TEMPLATE_FALLBACK is the one that never overclaims enclave
    // verification for a strategy we cannot vouch for.
    provenance: "TEMPLATE_FALLBACK",
    slots: [],
  };
}

/** A cache entry, rebuilt as a fresh Position: nothing consumed, no fills yet. Used for the optimistic entry shown immediately after a ship, before the subgraph has indexed it. */
export function positionFromMeta(
  hash: Hex,
  meta: CachedStrategyMeta,
  fills: Fill[] = [],
): Position {
  return {
    id: hash,
    strategyHash: hash,
    pair: meta.pair,
    templateLabel: meta.templateLabel,
    description: meta.description,
    bandKind: meta.bandKind,
    band: meta.band,
    bandNote: meta.bandNote,
    legs: meta.legs.map((leg) => ({ ...leg, consumed: 0n })),
    fills,
    deadline: meta.deadline,
    dockedAt: null,
    risk: meta.risk,
    provenance: meta.provenance,
    slots: meta.slots,
  };
}

/** The inverse of `positionFromMeta` — what to cache from an already-built Position (a demo fixture, say). Drops `consumed`/`fills`/`dockedAt`: those are the chain's to report, not ours to remember. */
export function metaFromPosition(p: Position): CachedStrategyMeta {
  return {
    pair: p.pair,
    templateLabel: p.templateLabel,
    description: p.description,
    bandKind: p.bandKind,
    band: p.band,
    bandNote: p.bandNote,
    legs: p.legs.map(({ token, symbol, decimals, virtual }) => ({
      token,
      symbol,
      decimals,
      virtual,
    })),
    deadline: p.deadline,
    risk: p.risk,
    provenance: p.provenance,
    slots: p.slots,
  };
}

/** "WETH / USDC" — sorted by decimals descending, matching the fixtures and the original single-market app. */
export function pairFromTokens(
  tokens: Array<{ symbol: string; decimals: number }>,
): string {
  return [...tokens]
    .sort((a, b) => b.decimals - a.decimals)
    .map((t) => t.symbol)
    .join(" / ");
}

// --------------------------------------------------------------- internals

function joinLegs(
  cachedLegs: CachedLeg[],
  balances: StrategyBalance[],
): PositionLeg[] {
  return cachedLegs.map((leg) => {
    const bal = balances.find(
      (b) => b.tokenAddress.toLowerCase() === leg.token.toLowerCase(),
    );
    // A leg missing from the on-chain balances (shouldn't happen — every
    // committed token gets a balance row) falls back to "as ceiling", i.e.
    // nothing consumed, rather than guessing.
    const remaining = bal ? BigInt(bal.virtualBalance) : leg.virtual;
    const consumed = leg.virtual > remaining ? leg.virtual - remaining : 0n;
    return {
      token: leg.token,
      symbol: leg.symbol,
      decimals: leg.decimals,
      virtual: leg.virtual,
      consumed,
    };
  });
}

function reducedLegs(balances: StrategyBalance[]): PositionLeg[] {
  return balances.map((bal) => {
    const meta = resolveBalanceMeta(bal);
    return {
      token: bal.tokenAddress as Address,
      symbol: meta.symbol,
      decimals: meta.decimals,
      // We only know the current remaining balance, not the original
      // ceiling, so there is nothing honest to show as "consumed".
      virtual: BigInt(bal.virtualBalance),
      consumed: 0n,
    };
  });
}

function resolveBalanceMeta(bal: StrategyBalance): {
  symbol: string;
  decimals: number;
} {
  const known = tokenBy(bal.tokenAddress as Address);
  if (known) return { symbol: known.symbol, decimals: known.decimals };
  return { symbol: bal.symbol ?? "TOKEN", decimals: bal.decimals ?? 18 };
}

function fillsFor(ls: LiveStrategy, recentFills: RecentFill[]): Fill[] {
  return recentFills
    .filter((f) => f.strategyId === ls.id)
    .map((f) => ({
      time: formatFillTime(f.ts),
      flow: describeFill(f),
    }));
}

function formatFillTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDayShort(unixSeconds)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "+1.5 WETH  →  −2000 USDC" — from the maker's side: received, then given. */
function describeFill(f: RecentFill): string {
  const received = f.tokenOut ?? "?";
  const given = f.tokenIn ?? "?";
  return `+${f.amountOutHuman} ${received}  →  −${f.amountInHuman} ${given}`;
}
