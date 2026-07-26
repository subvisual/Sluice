import test from "node:test";
import assert from "node:assert/strict";
import type { UserBook } from "@sluice/arbitration-sdk/subgraph";
import { joinBook, metaFromPosition, pairFromTokens, positionFromMeta } from "./join-book";
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

function bookWith(overrides: Partial<UserBook>): UserBook {
  return {
    maker: "0xmaker",
    strategyCount: 1,
    liveStrategyCount: 1,
    tokenBooks: [],
    liveStrategies: [],
    recentFills: [],
    ...overrides,
  };
}

test("joinBook returns null when the book itself is null (subgraph unavailable)", () => {
  assert.equal(joinBook(null, {}), null);
});

test("joinBook returns [] for a valid book with no live strategies (not the same as null)", () => {
  const result = joinBook(bookWith({ liveStrategies: [] }), {});
  assert.deepEqual(result, []);
});

test("joinBook joins a live strategy against cached metadata: consumed = ceiling - virtualBalance", () => {
  const cache: StrategyCache = { [HASH_A]: CACHE_A };
  const book = bookWith({
    liveStrategies: [
      {
        id: "strat-1",
        strategyHash: HASH_A,
        app: "0xapp",
        fillCount: 2,
        balances: [
          { tokenAddress: USDC, symbol: "USDC", decimals: 6, virtualBalance: "1000000000", virtualBalanceHuman: "1000" },
          { tokenAddress: WETH, symbol: "WETH", decimals: 18, virtualBalance: "500000000000000000", virtualBalanceHuman: "0.5" },
        ],
      },
    ],
    recentFills: [
      {
        id: "fill-1",
        taker: "0xtaker",
        tokenIn: "USDC",
        tokenOut: "WETH",
        amountIn: "2000000000",
        amountInHuman: "2000",
        amountOut: "1500000000000000000",
        amountOutHuman: "1.5",
        ts: 1_999_000_000,
        block: 100,
        strategyId: "strat-1",
      },
      {
        // Belongs to a different strategy — must not leak into this position's fills.
        id: "fill-2",
        taker: "0xtaker2",
        tokenIn: "WETH",
        tokenOut: "USDC",
        amountIn: "1000000000000000000",
        amountInHuman: "1",
        amountOut: "3000000000",
        amountOutHuman: "3000",
        ts: 1_999_000_500,
        block: 101,
        strategyId: "strat-other",
      },
    ],
  });

  const positions = joinBook(book, cache);
  assert.equal(positions?.length, 1);
  const p = positions![0];

  assert.equal(p.strategyHash, HASH_A);
  assert.equal(p.id, HASH_A);
  assert.equal(p.pair, "WETH / USDC");
  assert.equal(p.templateLabel, "tight-clmm");
  assert.equal(p.risk, "low");
  assert.equal(p.provenance, "ENCLAVE");
  assert.equal(p.dockedAt, null);

  const usdcLeg = p.legs.find((l) => l.symbol === "USDC")!;
  assert.equal(usdcLeg.virtual, 3_000_000_000n);
  assert.equal(usdcLeg.consumed, 3_000_000_000n - 1_000_000_000n);

  const wethLeg = p.legs.find((l) => l.symbol === "WETH")!;
  assert.equal(wethLeg.virtual, 2_000_000_000_000_000_000n);
  assert.equal(wethLeg.consumed, 2_000_000_000_000_000_000n - 500_000_000_000_000_000n);

  // Only the fill for THIS strategy id is attached.
  assert.equal(p.fills.length, 1);
  assert.match(p.fills[0].flow, /1\.5 WETH/);
  assert.match(p.fills[0].flow, /2000 USDC/);
});

test("joinBook clamps consumed at 0 if a stale cache ceiling is smaller than the on-chain remaining balance", () => {
  const cache: StrategyCache = {
    [HASH_A]: { ...CACHE_A, legs: [{ token: USDC, symbol: "USDC", decimals: 6, virtual: 100n }] },
  };
  const book = bookWith({
    liveStrategies: [
      {
        id: "strat-1",
        strategyHash: HASH_A,
        app: "0xapp",
        fillCount: 0,
        balances: [
          { tokenAddress: USDC, symbol: "USDC", decimals: 6, virtualBalance: "999999999999", virtualBalanceHuman: "999999.999999" },
        ],
      },
    ],
  });
  const positions = joinBook(book, cache);
  assert.equal(positions![0].legs[0].consumed, 0n);
});

test("joinBook produces a reduced Position for a live strategy with no cache match", () => {
  const book = bookWith({
    liveStrategies: [
      {
        id: "strat-2",
        strategyHash: HASH_B,
        app: "0xapp",
        fillCount: 0,
        balances: [
          { tokenAddress: WETH, symbol: "WETH", decimals: 18, virtualBalance: "1000000000000000000", virtualBalanceHuman: "1" },
        ],
      },
    ],
  });

  const positions = joinBook(book, {});
  assert.equal(positions?.length, 1);
  const p = positions![0];

  assert.equal(p.strategyHash, HASH_B);
  assert.equal(p.templateLabel, "Aqua strategy");
  assert.equal(p.risk, null);
  assert.deepEqual(p.slots, []);
  assert.equal(p.pair, "WETH");
  assert.equal(p.legs.length, 1);
  assert.equal(p.legs[0].virtual, 1_000_000_000_000_000_000n);
  assert.equal(p.legs[0].consumed, 0n);
  assert.equal(p.dockedAt, null);
});

test("joinBook falls back to on-chain token metadata for an unmatched strategy with an unknown token", () => {
  const alien = "0x000000000000000000000000000000000000dEaD";
  const book = bookWith({
    liveStrategies: [
      {
        id: "strat-3",
        strategyHash: HASH_B,
        app: "0xapp",
        fillCount: 0,
        balances: [
          { tokenAddress: alien, symbol: "ALIEN", decimals: 9, virtualBalance: "42", virtualBalanceHuman: "0.000000042" },
        ],
      },
    ],
  });
  const positions = joinBook(book, {});
  const leg = positions![0].legs[0];
  assert.equal(leg.symbol, "ALIEN");
  assert.equal(leg.decimals, 9);
  assert.equal(leg.virtual, 42n);
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
