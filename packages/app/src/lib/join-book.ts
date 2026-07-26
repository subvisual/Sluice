import type { Address, Hex } from "viem";
import type { Position, Provenance, RiskRating, SlotRow } from "./book";
import type { UiStrategy } from "./compose/from-server";

/**
 * The pure JOIN: decoded on-chain positions (`/api/book`, which reads the
 * subgraph and decodes each strategy's program server-side) + locally-cached
 * ship-time metadata → the `Position[]` the dashboard renders. No fetch, no
 * React, no clock — everything here is a plain function of its inputs, which
 * is what makes it unit-testable without a chain or a subgraph.
 *
 * `strategyHash` is the join key (Wiring §10, spec Slice B). The chain row is
 * authoritative for everything it can prove: legs (ceiling from the
 * ship-funding event, consumed from balance movement), fills, deadline and
 * slot rows (decoded from the program bytes), docked state. The cache
 * supplies only what a recommendation knows and the chain does not: the
 * ship-time wording, band terms, risk rating, provenance. A cache-miss row
 * is therefore still a full position — just labelled with what was decoded
 * rather than what was recommended.
 */

/** One leg's ceiling as recorded at ship time — no `consumed`, that is the chain's to report. */
export type CachedLeg = {
  token: Address;
  symbol: string;
  decimals: number;
  virtual: bigint;
};

/** Everything about a strategy that ship time knows and the chain does not. */
export type CachedStrategyMeta = {
  pair: string;
  templateLabel: string;
  description: string;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  legs: CachedLeg[];
  deadline: number | null;
  risk: RiskRating | null;
  provenance: Provenance;
  slots: SlotRow[];
};

/** Keyed by the real, on-chain `strategyHash` — the only stable join key. */
export type StrategyCache = Record<Hex, CachedStrategyMeta>;

/**
 * Join fetched positions against the local cache. `chain === null` (subgraph
 * unavailable) stays `null` — never collapse it into `[]`, the dashboard
 * renders those two completely differently (Wiring §10).
 */
export function joinBook(
  chain: Position[] | null,
  cache: StrategyCache,
): Position[] | null {
  if (chain === null) return null;
  return chain.map((p) => toPosition(p, cache[p.strategyHash]));
}

/** One decoded chain row → one rendered Position, with or without a cache match. */
export function toPosition(
  p: Position,
  cached: CachedStrategyMeta | undefined,
): Position {
  if (!cached) return p;
  return {
    ...p,
    // Recommendation-only fields: the cache's wording and terms are richer
    // than what a program decode can recover (exact band %, risk, who
    // produced it) — but legs, fills, dockedAt stay the chain's.
    pair: cached.pair,
    templateLabel: cached.templateLabel,
    description: cached.description,
    bandKind: cached.bandKind,
    band: cached.band,
    bandNote: cached.bandNote,
    risk: cached.risk,
    provenance: cached.provenance,
    // Decoded slot rows exist even for foreign programs; prefer the cached
    // ones (band % instead of raw deltas) when the cache has them.
    slots: cached.slots.length > 0 ? cached.slots : p.slots,
    // The decode is authoritative (it read the shipped bytes) — the cache
    // only fills in when the bytes would not decode at all.
    deadline: p.deadline ?? cached.deadline,
  };
}

/** A cache entry, rebuilt as a fresh Position: nothing consumed, no fills yet. Used for the optimistic entry shown immediately after a ship, before the subgraph has indexed it. */
export function positionFromMeta(
  hash: Hex,
  meta: CachedStrategyMeta,
  fills: Position["fills"] = [],
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

/**
 * One shipped strategy → the metadata this browser caches for it.
 *
 * The pair label comes from the strategy's OWN legs. It used to come from the
 * whole selectable token list, which was indistinguishable from correct while
 * that list held exactly two tokens and wrong the moment it held more — and
 * strategies within one recommendation need not share a pair anyway.
 */
export function metaFromUiStrategy(
  strategy: UiStrategy,
  provenance: Provenance,
): CachedStrategyMeta {
  return {
    pair: pairFromTokens(strategy.legs.map((l) => l.token)),
    templateLabel: strategy.templateShort,
    description: strategy.description,
    bandKind: strategy.bandKind,
    band: strategy.band,
    bandNote: strategy.bandNote,
    legs: strategy.legs.map(({ token, virtual }) => ({
      token: token.address,
      symbol: token.symbol,
      decimals: token.decimals,
      virtual,
    })),
    deadline: strategy.deadline,
    risk: strategy.risk,
    provenance,
    slots: strategy.slots,
  };
}
