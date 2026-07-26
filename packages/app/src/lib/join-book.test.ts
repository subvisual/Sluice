import test from "node:test";
import assert from "node:assert/strict";
import {
  joinBook,
  metaFromPosition,
  pairFromTokens,
  positionFromMeta,
} from "./join-book";
import type { CachedStrategyMeta, StrategyCache } from "./join-book";
import type { Position } from "./book";

const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const HASH_A =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const HASH_B =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

const CACHE_A: CachedStrategyMeta = {
  pair: "WETH / USDC",
  templateLabel: "tight-clmm",
  description: "a narrow band around mid",
  bandKind: "band",
  band: "±1.00%",
  bandNote: "narrow band, partial fills",
  legs: [
    { token: USDC, symbol: "USDC", decimals: 6, virtual: 3_000_000_000n },
    { token: WETH, symbol: "WETH", decimals: 18, virtual: 2_000_000_000_000_000_000n },
  ],
  deadline: 2_000_000_000,
  risk: "low",
  provenance: "ENCLAVE",
  slots: [{ index: 1, name: "curve", instruction: "XYC_SWAP_XD", params: "…" }],
};

/** A decoded chain row as `/api/book` hands it over (post-revive). */
function chainRow(overrides: Partial<Position> = {}): Position {
  return {
    id: "0xmaker-app-hash",
    strategyHash: HASH_A,
    pair: "WETH / USDC",
    templateLabel: "market-make the whole curve",
    description: "Read back from the aqua subgraph.",
    bandKind: "band",
    band: "full range",
    bandNote: "constant product · fills at any price",
    legs: [
      {
        token: USDC,
        symbol: "USDC",
        decimals: 6,
        virtual: 3_000_000_000n,
        consumed: 2_000_000_000n,
      },
    ],
    fills: [{ time: "Jul 25 · 09:12", flow: "+1 USDC  →  −1 WETH" }],
    deadline: 1_900_000_000,
    dockedAt: null,
    risk: null,
    provenance: null,
    slots: [
      { index: 1, name: "salt", instruction: "SALT", params: "0x01" },
      { index: 2, name: "deadline", instruction: "DEADLINE", params: "1900000000" },
    ],
    ...overrides,
  };
}

test("joinBook returns null when the chain read is null (subgraph unavailable)", () => {
  assert.equal(joinBook(null, {}), null);
});

test("joinBook returns [] for a successful read with no strategies (not the same as null)", () => {
  assert.deepEqual(joinBook([], {}), []);
});

test("a cache hit overlays recommendation metadata but keeps the chain's legs, fills and dock state", () => {
  const cache: StrategyCache = { [HASH_A]: CACHE_A };
  const positions = joinBook([chainRow()], cache);
  assert.equal(positions?.length, 1);
  const p = positions![0];

  // Recommendation-only fields come from the cache…
  assert.equal(p.templateLabel, "tight-clmm");
  assert.equal(p.description, "a narrow band around mid");
  assert.equal(p.band, "±1.00%");
  assert.equal(p.risk, "low");
  assert.equal(p.provenance, "ENCLAVE");
  assert.deepEqual(p.slots, CACHE_A.slots);

  // …but the chain stays authoritative for amounts, fills, and status.
  assert.equal(p.legs[0].virtual, 3_000_000_000n);
  assert.equal(p.legs[0].consumed, 2_000_000_000n);
  assert.equal(p.fills.length, 1);
  assert.equal(p.dockedAt, null);
  // The decoded deadline wins — it read the shipped bytes.
  assert.equal(p.deadline, 1_900_000_000);
});

test("a cache hit with empty cached slots keeps the decoded slot rows", () => {
  const cache: StrategyCache = { [HASH_A]: { ...CACHE_A, slots: [] } };
  const [p] = joinBook([chainRow()], cache)!;
  assert.equal(p.slots.length, 2);
  assert.equal(p.slots[0].instruction, "SALT");
});

test("the cached deadline fills in only when the program did not decode", () => {
  const cache: StrategyCache = { [HASH_A]: CACHE_A };
  const [p] = joinBook([chainRow({ deadline: null })], cache)!;
  assert.equal(p.deadline, 2_000_000_000);
});

test("a cache miss passes the decoded row through unchanged", () => {
  const row = chainRow({ strategyHash: HASH_B });
  const [p] = joinBook([row], {})!;
  assert.deepEqual(p, row);
  // In particular: null provenance (no local record — never claim
  // "TEMPLATE_FALLBACK"/"not signed" for a strategy we know nothing about),
  // and the honest decoded labels.
  assert.equal(p.provenance, null);
  assert.equal(p.risk, null);
});

test("pairFromTokens sorts by decimals descending and joins symbols", () => {
  assert.equal(
    pairFromTokens([
      { symbol: "USDC", decimals: 6 },
      { symbol: "WETH", decimals: 18 },
    ]),
    "WETH / USDC",
  );
});

test("metaFromPosition extracts cacheable fields and positionFromMeta rebuilds a fresh (unconsumed) Position", () => {
  const shipped: Position = {
    id: "0xdead",
    strategyHash: "0xdead" as `0x${string}`,
    pair: "WETH / USDC",
    templateLabel: "oracle-limit",
    description: "sells at a level",
    bandKind: "level",
    band: "sells at 2600",
    bandNote: "all-or-nothing",
    legs: [
      { token: WETH, symbol: "WETH", decimals: 18, virtual: 1_000_000_000_000_000_000n, consumed: 0n },
    ],
    fills: [],
    deadline: 2_000_000_000,
    dockedAt: null,
    risk: "medium",
    provenance: "ENCLAVE",
    slots: [],
  };

  const meta = metaFromPosition(shipped);
  const rebuilt = positionFromMeta(HASH_A, meta);

  assert.equal(rebuilt.strategyHash, HASH_A);
  assert.equal(rebuilt.id, HASH_A);
  assert.equal(rebuilt.templateLabel, "oracle-limit");
  assert.equal(rebuilt.legs[0].virtual, 1_000_000_000_000_000_000n);
  // Freshly (re)built from meta: nothing consumed, no fills yet.
  assert.equal(rebuilt.legs[0].consumed, 0n);
  assert.deepEqual(rebuilt.fills, []);
  assert.equal(rebuilt.dockedAt, null);
});
