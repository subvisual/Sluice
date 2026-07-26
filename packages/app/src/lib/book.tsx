"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Address, Hex } from "viem";
import { useAccount } from "wagmi";
import { demoBook } from "./demo-book";
import {
  joinBook,
  metaFromPosition,
  pairFromTokens,
  positionFromMeta,
  type CachedStrategyMeta,
  type StrategyCache,
} from "./join-book";
import { revivePosition, type PositionDto } from "./position-dto";
import { TOKENS } from "./tokens";
import type { UiRecommendation } from "./compose/from-server";

/**
 * The user's book — every strategy this wallet has shipped.
 *
 * The real source is the F3 book subgraph (`GET /api/book`), read for the
 * connected address: every strategy ANY status, with the program already
 * decoded server-side (deadline, slot rows, template match). `null` means
 * "unknown" (the subgraph read failed, or there is no connected address to
 * read for) — the dashboard must render that as unavailable, never as "no
 * positions" (Wiring §10). `[]` means the read succeeded and genuinely found
 * nothing.
 *
 * The chain alone cannot say how a strategy was recommended: risk rating,
 * the recommendation's wording and band terms live only in the signed
 * recommendation (until the RecommendationRegistry ships). So this module
 * also keeps a local metadata cache, keyed by the real on-chain
 * `strategyHash` and persisted to `localStorage`, written whenever this
 * browser ships (`recordShipped`) or seeds the demo fixtures (`showDemo`).
 * `src/lib/join-book.ts` does the actual JOIN — this file is the fetch, the
 * cache, and the optimistic overlay around it.
 */

export type RiskRating = "low" | "medium" | "high";

/**
 * Who produced the recommendation this position came from — F2 §4.
 * `null` is distinct from `"TEMPLATE_FALLBACK"`: it means this browser has no
 * local record at all (a cache-miss position — shipped elsewhere, or before
 * this browser cached it), not that the strategy is known to be unsigned.
 * Never render `null` as "not signed" — that overclaims something we cannot
 * check either way (Task 6 review finding 2).
 */
export type Provenance = "ENCLAVE" | "TEMPLATE_FALLBACK" | null;

export type PositionLeg = {
  token: Address;
  symbol: string;
  decimals: number;
  /** The ceiling the user authorised — never a balance, never a transfer. */
  virtual: bigint;
  consumed: bigint;
};

/** One executed fill, as the subgraph hands it over (display strings). */
export type Fill = { time: string; flow: string };

export type SlotRow = {
  index: number;
  name: string;
  instruction: string;
  params: string;
};

export type Position = {
  /** `strategyHash` keys the position on-chain; unique enough for the UI. */
  id: string;
  strategyHash: Hex;
  /** e.g. "WETH / USDC" — the market pair, not the committed tokens. */
  pair: string;
  /** `TEMPLATES[].label` minus the `T1 · ` prefix. */
  templateLabel: string;
  /** From the recommendation, not generated client-side. */
  description: string;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  legs: PositionLeg[];
  fills: Fill[];
  /**
   * Unix seconds; at expiry the position unwinds automatically. `null` when
   * the on-chain program carries no DEADLINE instruction (a strategy shipped
   * outside Sluice) — rendered as "no deadline", never as 1970 or a made-up
   * future date.
   */
  deadline: number | null;
  /** Unix seconds; set when the user docks. Docked hashes are burned forever. */
  dockedAt: number | null;
  /** Absent rating renders "risk rating unavailable" — never a number. */
  risk: RiskRating | null;
  provenance: Provenance;
  slots: SlotRow[];
};

export type PositionStatus = "Live" | "Expired" | "Docked";

export function positionStatus(p: Position, nowSec: number): PositionStatus {
  if (p.dockedAt !== null) return "Docked";
  return p.deadline !== null && p.deadline <= nowSec ? "Expired" : "Live";
}

type BookValue = {
  /** `null` = book unknown (subgraph unavailable, or nothing connected). */
  positions: Position[] | null;
  /** True while an `/api/book` read is in flight. */
  isLoading: boolean;
  /** Re-reads `/api/book` for the connected address; also clears the local dock overlay. */
  refetch: () => void;
  /** One metadata cache entry per shipped strategy, keyed by its real `strategyHash`. */
  recordShipped: (rec: UiRecommendation, hashes: Hex[]) => void;
  /** Local optimistic dock — real dock() is out of scope; `refetch` resets it. */
  dock: (id: string) => void;
  /** Seeds the fixture positions from `demo-book.ts` — kept at the team's request. */
  showDemo: () => void;
};

const BookContext = createContext<BookValue | null>(null);

const CACHE_STORAGE_KEY = "sluice.book.cache.v1";

function serializeCache(cache: StrategyCache): string {
  return JSON.stringify(cache, (_key, value) =>
    typeof value === "bigint" ? { $bigint: value.toString() } : value,
  );
}

function deserializeCache(raw: string): StrategyCache {
  return JSON.parse(raw, (_key, value) =>
    value && typeof value === "object" && "$bigint" in value
      ? BigInt(value.$bigint)
      : value,
  ) as StrategyCache;
}

/** Reads localStorage — never called during SSR/first render. */
function loadCache(): StrategyCache {
  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY);
    return raw ? deserializeCache(raw) : {};
  } catch {
    // Corrupt entry or storage unavailable (private browsing) — an empty
    // cache degrades every position to the reduced card, never a crash.
    return {};
  }
}

export function BookProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();

  // Lazily hydrated from localStorage on first render, not in an effect: this
  // runs once per mount, and on the client (where the initializer actually
  // executes with `window` defined) that first render IS the hydration. SSR's
  // reference to `window` throws inside `loadCache`, which is caught there and
  // returns `{}` — no crash, just an empty cache until the client takes over.
  const [cache, setCache] = useState<StrategyCache>(() => loadCache());

  // Tagged with the address it was resolved for — the join below only trusts
  // this when `bookFetch.address === address`, so switching accounts can
  // never show the previous account's positions (Task 6 review finding 3):
  // the moment `address` changes, this is stale by construction and treated
  // exactly like "not fetched yet", not like real data for the new address.
  // `book: null` inside a resolved entry means the read failed (still
  // distinct from "not fetched yet", which is `bookFetch` not matching
  // `address` at all, or being `null`).
  const [bookFetch, setBookFetch] = useState<{
    address: Address;
    book: Position[] | null;
  } | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);

  // Optimistic entries this session already knows about but the subgraph may
  // not have indexed yet (a just-shipped strategy) or never will (a demo
  // fixture). Deduped against the joined book below by strategyHash, so once
  // the real read catches up the optimistic copy quietly disappears.
  const [optimistic, setOptimistic] = useState<Position[]>([]);
  // Local-only dock overlay; a real dock is out of scope for this build
  // (Wiring §10) — `refetch` resets it, and so does a genuine account switch.
  const [dockOverrides, setDockOverrides] = useState<Record<string, number>>({});

  // Persist on every change. The very first run just writes back whatever
  // `loadCache()` produced above (identical bytes, or `{}` the first time
  // this browser ever ships) — harmless.
  useEffect(() => {
    try {
      window.localStorage.setItem(CACHE_STORAGE_KEY, serializeCache(cache));
    } catch {
      // Storage full or unavailable — the cache still works for this session.
    }
  }, [cache]);

  // Tracks the address the CURRENT `optimistic`/`dockOverrides` state belongs
  // to, purely to detect a genuine account switch inside the effect below
  // (comparing a ref, not React state — this assignment is not a render-time
  // side effect the `set-state-in-render` check cares about). Reset to
  // `undefined` on disconnect so reconnecting — even to the same address —
  // starts from a clean local overlay rather than assuming continuity.
  const lastAddressRef = useRef<Address | undefined>(undefined);

  useEffect(() => {
    // Nothing to synchronize when there is no connected address — deliberately
    // no setState here. `positions`/`isLoading` below read `isConnected`
    // directly instead of needing this effect to reset stored state, which
    // keeps this branch a plain early return rather than state we'd otherwise
    // have to derive during render anyway.
    if (!isConnected || !address) {
      lastAddressRef.current = undefined;
      return;
    }

    const isAccountSwitch = lastAddressRef.current !== address;
    lastAddressRef.current = address;

    let cancelled = false;

    // A nested function, not statements directly in the effect body: every
    // `setState` call here is synchronizing with the outcome of the `fetch`
    // this same closure performs, which is the legitimate case effects exist
    // for — as opposed to a top-level `setState` with nothing external behind
    // it, which the compiler's `set-state-in-effect` check (rightly) flags.
    const run = async () => {
      // Only on a genuine address change (not a same-address `refetch()`) —
      // a different account's just-shipped/demo overlay must not bleed into
      // this one (Task 6 review finding 3). `refetch()` alone must NOT clear
      // `optimistic`: a just-shipped position needs to survive the refetch it
      // itself triggers, before the subgraph has necessarily indexed it yet.
      if (isAccountSwitch) setOptimistic([]);
      setDockOverrides({});
      try {
        const res = await fetch(`/api/book?maker=${address}`);
        if (!res.ok) throw new Error(`book fetch failed with status ${res.status}`);
        const body = (await res.json()) as { positions: PositionDto[] };
        const book = body.positions.map(revivePosition);
        if (!cancelled) setBookFetch({ address, book });
      } catch {
        // Unavailable, not empty — `joinBook(null, …)` preserves that.
        if (!cancelled) setBookFetch({ address, book: null });
      }
    };
    run();

    return () => {
      cancelled = true;
    };
    // `refetchTick` is a deliberate dependency — it is the only thing that
    // changes on `refetch()` when `address`/`isConnected` have not.
  }, [address, isConnected, refetchTick]);

  // Only trust a `bookFetch` resolved for the address connected RIGHT NOW.
  // `undefined` = nothing resolved yet for this exact address (first read in
  // flight, or an address switch invalidated the previous one); `null` =
  // resolved, but the read failed; a `Position[]` = resolved successfully.
  const currentBook: Position[] | null | undefined =
    address && bookFetch?.address === address ? bookFetch.book : undefined;

  const isLoading =
    isConnected && Boolean(address) && currentBook === undefined;

  const refetch = useCallback(() => setRefetchTick((t) => t + 1), []);

  const recordShipped = useCallback((rec: UiRecommendation, hashes: Hex[]) => {
    const pair = pairFromTokens(TOKENS);
    const entries: Array<[Hex, CachedStrategyMeta]> = rec.strategies.map(
      (s, i) => [
        hashes[i],
        {
          pair,
          templateLabel: s.templateShort,
          description: s.description,
          bandKind: s.bandKind,
          band: s.band,
          bandNote: s.bandNote,
          legs: s.legs.map(({ token, virtual }) => ({
            token: token.address,
            symbol: token.symbol,
            decimals: token.decimals,
            virtual,
          })),
          deadline: s.deadline,
          risk: s.risk,
          provenance: rec.provenance,
          slots: s.slots,
        },
      ],
    );

    setCache((prev) => {
      const next = { ...prev };
      for (const [hash, meta] of entries) next[hash] = meta;
      return next;
    });

    setOptimistic((prev) => [
      ...entries.map(([hash, meta]) => positionFromMeta(hash, meta)),
      ...prev,
    ]);
  }, []);

  const showDemo = useCallback(() => {
    const fixtures = demoBook();
    setCache((prev) => {
      const next = { ...prev };
      for (const p of fixtures) next[p.strategyHash] = metaFromPosition(p);
      return next;
    });
    setOptimistic((prev) => [...fixtures, ...prev]);
  }, []);

  const dock = useCallback((id: string) => {
    setDockOverrides((prev) => ({ ...prev, [id]: Math.floor(Date.now() / 1000) }));
  }, []);

  const positions = useMemo(() => {
    // Not connected, or connected but nothing resolved for this address yet
    // (including "loading" and "an address switch invalidated the previous
    // read") → nothing real to join. Checked directly rather than mirrored
    // into stored state — a stale read from a previous address is simply
    // ignored here, never surfaced under the new one (Task 6 review finding 3).
    const bookForJoin = isConnected && address && currentBook !== undefined ? currentBook : null;
    const joined = joinBook(bookForJoin, cache);

    // `joined === null` alone would mean "unavailable" — but the demo
    // affordance and a just-shipped position both live in `optimistic`
    // regardless of whether the real book could be read at all, and BOTH
    // are reachable from the unavailable/disconnected states now (Task 6
    // review finding 1: "Show demo positions" has to work from
    // `BookUnavailable`, not only from the empty state). So an unavailable
    // real book with something in the optimistic overlay is not "unknown"
    // any more — it is exactly that overlay.
    if (joined === null && optimistic.length === 0) return null;

    const joinedList = joined ?? [];
    const joinedHashes = new Set(joinedList.map((p) => p.strategyHash));
    const extra = optimistic.filter((p) => !joinedHashes.has(p.strategyHash));
    const merged = [...extra, ...joinedList];

    return merged.map((p) =>
      dockOverrides[p.id] !== undefined
        ? { ...p, dockedAt: dockOverrides[p.id] }
        : p,
    );
  }, [isConnected, address, currentBook, cache, optimistic, dockOverrides]);

  const value = useMemo(
    () => ({ positions, isLoading, refetch, recordShipped, dock, showDemo }),
    [positions, isLoading, refetch, recordShipped, dock, showDemo],
  );

  return <BookContext.Provider value={value}>{children}</BookContext.Provider>;
}

export function useBook(): BookValue {
  const value = useContext(BookContext);
  if (!value) throw new Error("useBook requires a BookProvider");
  return value;
}
