# Aqua Subgraph — Design

**Date:** 2026-07-25
**Status:** Approved design, pre-implementation
**Location:** `subgraph/` in the Sluice repo (git@github.com:subvisual/Sluice.git). All implementation paths in this spec are relative to `subgraph/`.
**Scope:** Generic 1inch Aqua protocol subgraph. Part of **F3 — The Agent's Eyes** (Notion page `3a8caae58631812cadd9df083e8d0dd9`), which is the feature's source of truth. Findings that correct or extend Notion get pushed back there when material.

## 1. Goal

Index the 1inch Aqua protocol (shared liquidity layer) so that any consumer — the Sluice agent's tick loop first among them — can query strategy lifecycle, per-token virtual balances, per-maker committed totals, and fills. No Aqua subgraph currently exists (verified, see §9); this is net-new.

**Relationship to the F3 schema (flagged per CLAUDE.md's ADR-conflict rule):** F3's Notion page specifies the *Sluice-specific* subgraph — SluiceApp events (`Shipped` with stable `strategyId`, `Filled`, `BookCommitted`/`TokenBookCommitted`) on our own deployment, with the `Strategy`(stable id)/`Shipping`(hash) split. This spec builds the layer *below* that: the **generic Aqua protocol subgraph** over AquaRouter/SwapVM's real events, targeting Ethereum mainnet first (real data exists since Nov 2025) and any other deployment — including our own testnet one — via `networks.json`. In the generic layer, the protocol's own storage key `(maker, app, strategyHash)` *is* the strategy identity; stable-`strategyId` threading requires SluiceApp's events and lands later as F3's data source on top. Decision made 2026-07-25 (generic layer first, mainnet first) — to be recorded on the F3 Notion page.

## 2. Architecture

Standard Graph Studio subgraph: AssemblyScript mappings, `specVersion` 1.2.0, event handlers only (no call handlers, no block handlers — nothing here needs tracing APIs).

Two data sources, Ethereum mainnet first:

| Data source | Address | startBlock | Events handled |
|---|---|---|---|
| `AquaRouter` | `0x499943e74fb0ce105688beee8ef2abec5d936d31` | 23816437 (2025-11-17) | `Shipped`, `Docked`, `Pulled`, `Pushed` |
| `AquaSwapVMRouter` | `0x8fdd04dbf6111437b44bbca99c28882434e0958f` | 23816440 (2025-11-17) | `Swapped` |

Multi-network via `networks.json`: the Aqua addresses are identical on 12 mainnet chains, and a testnet self-deploy is a config entry, not a code change. Schema and mappings are chain-agnostic.

## 3. Verified protocol mechanics the design rests on

From `1inch/aqua` and `1inch/swap-vm` source (cloned and read, not inferred from docs):

1. **Aqua core emits exactly four events**, none with indexed params:
   - `Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)` — carries full strategy bytes for data availability
   - `Docked(address maker, address app, bytes32 strategyHash)` — no token list
   - `Pulled(address maker, address app, bytes32 strategyHash, address token, uint256 amount)`
   - `Pushed(address maker, address app, bytes32 strategyHash, address token, uint256 amount)`
2. **`ship()` emits `Pushed` once per token with the initial amounts** (after `Shipped`, same tx, sequential logIndex). Virtual balances are therefore fully reconstructible from events alone — no `eth_call`, no calldata decoding.
3. **`strategyHash = keccak256(strategy bytes)`** (confirmed in `Aqua.sol` and by `AquaProtocolContract.calculateStrategyHash` in the official SDK).
4. **Strategy identity is `(maker, app, strategyHash)`** — the contract's own storage key. Hashes are single-use per (maker, app): re-shipping a docked hash reverts (`StrategiesMustBeImmutable`).
5. **SwapVM's `Swapped(orderHash, maker, taker, tokenIn, tokenOut, amountIn, amountOut)`**: for Aqua-mode orders, `orderHash = keccak256(abi.encode(order))` and the shipped strategy bytes are `abi.encode(order)` — so **`orderHash == strategyHash`**, giving a deterministic Fill → Strategy link.
6. **`dock()` zeroes all balances**; `push()` to a docked strategy reverts; `pull()` beyond balance underflows and reverts. Reverted operations emit nothing (honesty constraint below).

## 4. Schema

```graphql
enum StrategyStatus { LIVE DOCKED }
enum BalanceEventKind { SHIP_FUND PULL PUSH }

type AquaProtocol @entity {          # singleton, id = "aqua"
  id: ID!
  strategyCount: Int!
  liveStrategyCount: Int!
  makerCount: Int!
  appCount: Int!
  fillCount: Int!
  lastUpdatedBlock: BigInt!
}

type Maker @entity {                 # id = maker address
  id: Bytes!
  strategyCount: Int!
  liveStrategyCount: Int!
  strategies: [Strategy!]! @derivedFrom(field: "maker")
  books: [MakerTokenBook!]! @derivedFrom(field: "maker")
  firstSeenAt: BigInt!
}

type App @entity {                   # id = app address
  id: Bytes!
  strategyCount: Int!
  liveStrategyCount: Int!
  strategies: [Strategy!]! @derivedFrom(field: "app")
}

type Token @entity {                 # id = token address
  id: Bytes!
  symbol: String                     # try_-calls; null if non-standard
  name: String
  decimals: Int
}

type Strategy @entity {              # id = maker-app-strategyHash (hex concat)
  id: Bytes!
  strategyHash: Bytes!
  maker: Maker!
  app: App!
  strategyData: Bytes!               # raw bytes from Shipped
  status: StrategyStatus!
  tokenAddresses: [Bytes!]!          # populated by SHIP_FUND events
  balances: [StrategyBalance!]! @derivedFrom(field: "strategy")
  fills: [Fill!]! @derivedFrom(field: "strategy")
  fillCount: Int!
  pullCount: Int!
  pushCount: Int!
  shippedAt: BigInt!
  shippedAtBlock: BigInt!
  shippedTx: Bytes!
  dockedAt: BigInt
  dockedAtBlock: BigInt
  dockedTx: Bytes
}

type StrategyBalance @entity {       # id = strategyId-token
  id: Bytes!
  strategy: Strategy!
  token: Token!
  virtualBalance: BigInt!            # current; 0 after dock
  initialVirtual: BigInt!            # from ship-funding Pushed
  totalPulled: BigInt!
  totalPushed: BigInt!               # excludes ship funding
  updatedAt: BigInt!
}

type MakerTokenBook @entity {        # id = maker-token
  id: Bytes!
  maker: Maker!
  token: Token!
  committedVirtual: BigInt!          # Σ virtualBalance over LIVE strategies
  liveStrategyCount: Int!
  updatedAt: BigInt!
}

type Fill @entity(immutable: true) { # id = txHash-logIndex
  id: Bytes!
  orderHash: Bytes!
  strategy: Strategy                 # null when order is not an Aqua strategy
  maker: Bytes!
  taker: Bytes!
  tokenIn: Token!
  tokenOut: Token!
  amountIn: BigInt!
  amountOut: BigInt!
  ts: BigInt!
  block: BigInt!
  tx: Bytes!
}

type BalanceEvent @entity(immutable: true) {  # id = txHash-logIndex
  id: Bytes!
  strategy: Strategy!
  token: Token!
  kind: BalanceEventKind!
  amount: BigInt!
  balanceAfter: BigInt!
  ts: BigInt!
  block: BigInt!
  tx: Bytes!
}
```

`MakerTokenBook.committedVirtual` is the over-commit **numerator**. The denominator (the maker's real wallet balance) is deliberately absent: it is not event-derivable and per the project spec must come from a live `eth_call` at read time.

## 5. Handler map

- `Shipped` → create `Strategy` (LIVE), upsert `Maker`/`App`, bump protocol counters.
- `Pushed` → if `strategy.shippedTx == event.tx` and the token is not yet in `tokenAddresses`: **SHIP_FUND** — create `StrategyBalance` with `initialVirtual`, append to `tokenAddresses`, add to `MakerTokenBook`. Otherwise: **PUSH** — increment `virtualBalance`, `totalPushed`, book. Either way create a `BalanceEvent` with the matching kind.
- `Pulled` → decrement `virtualBalance`, increment `totalPulled`, decrement book, bump `pullCount`. Create `BalanceEvent(PULL)`.
- `Docked` → status DOCKED, for each token in `tokenAddresses`: subtract remaining `virtualBalance` from the book, zero it. Decrement live counts, set dock timestamps.
- `Swapped` → create `Fill`; look up `Strategy` by id `maker-<dataSource.address()>-orderHash`; link if found (else `strategy` stays null); bump `fillCount`s. Never touches balances — the swap's own `Pulled`/`Pushed` events already account for them (no double counting).

Ordering: handlers within a tx run in logIndex order, so `Shipped` precedes its funding `Pushed` events — the SHIP_FUND detection relies only on that. No cross-data-source ordering assumptions.

## 6. Honesty constraints (inherited from the project spec)

Subgraphs index successful transactions only. Therefore: no `starved` field, no revert data, no mempool data, no PnL (handlers have no prices), no real-balance field. Contention metrics (over-commit ratio, near-miss pressure, starvation proxy) are **derived by consumers** from these indexed facts plus a live `balanceOf`. The README states this explicitly.

## 7. Testing (matchstick)

1. Ship + funding `Pushed` events → `Strategy` LIVE, `StrategyBalance.initialVirtual` set, `MakerTokenBook` sums correct.
2. `Pulled`/`Pushed` after ship → delta accounting and `BalanceEvent` kinds correct.
3. `Docked` → balances zeroed, book decremented by remaining (not initial) amounts, status flipped.
4. `Swapped` with matching `(maker, swapVM, orderHash)` → `Fill` linked; non-matching → `Fill` with null strategy.
5. Continuity: ship A → fill → ship B → dock A; `MakerTokenBook` equals Σ live balances throughout.
6. Event topic assertions: hardcode the official topic0 hashes from `@1inch/aqua-sdk` (e.g. `Shipped` = `0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0`) and assert our ABI files produce them — ABI drift fails loudly.

## 8. Deliverables & layout

```
aqua-subgraph/
  schema.graphql
  subgraph.yaml            # mainnet defaults
  networks.json            # mainnet + placeholders (base, sepolia, base-sepolia, …)
  abis/Aqua.json           # mirrored from @1inch/aqua-sdk AQUA_ABI
  abis/SwapVM.json         # Swapped event (+ ERC20.json for token metadata)
  src/aqua.ts              # core handlers
  src/swap-vm.ts           # Swapped handler
  src/helpers.ts           # entity get-or-create, ids, constants
  tests/                   # matchstick
  docs/superpowers/specs/  # this file
  README.md
```

`graph codegen && graph build && graph test` green is the definition of done for implementation. Deploying to Graph Studio is a final manual step (needs the user's Studio slug and deploy key).

README includes: what is indexed and what deliberately is not (§6), example queries (maker book state, live strategies with balances, fills per strategy), multi-network instructions, and an **agent-consumer section**: how to query this subgraph via The Graph's MCP server (load the `graphql://subgraph` server-instructions resource at conversation start, run `get_deployment_30day_query_counts` before selecting a deployment, then `execute_query_by_subgraph_id` / `_by_ipfs_hash`), with this subgraph's IDs filled in after deploy.

## 9. Ecosystem verification (evidence for "no Aqua subgraph exists")

Checked 2026-07-25 via The Graph MCP tools: keyword search "aqua" returns exactly three subgraphs — `aqua-base-test`, `aqua-base`, `Aqua Patina Ethereum` — all with **0 queries in the last 30 days**, and the contract-address lookup for mainnet `AquaRouter` returns **no deployments**. No active Aqua subgraph exists; none exists for Ethereum mainnet. (The two `aqua-base` entries look like a Base-chain experiment — remember they exist before claiming "first ever" rather than "first active / first mainnet".)

## 10. References

- Protocol source: https://github.com/1inch/aqua (`src/Aqua.sol`, `src/interfaces/IAqua.sol`, README incl. 12-chain address table) — protocol-mechanics reference
- SwapVM source: https://github.com/1inch/swap-vm (`src/SwapVM.sol` `Swapped` event, `routers/AquaSwapVMRouter.sol`)
- Official TS SDK: https://github.com/1inch/sdks/tree/master/typescript/aqua (`AQUA_ABI`, event topic hashes, `calculateStrategyHash`) — ABIs mirrored from here
- Project reference (source of truth): Notion — "Sluice v2 — Fillability Layer for Over-Committed Aqua Books" + "Development Plan — Schemas, Contracts & 36h Build Order"

## 11. Findings to push back to Notion (when material work lands)

1. "No existing Aqua subgraph" is now *verified*, with evidence (§9) — strengthen the Graph-track pitch wording.
2. `ship()` emits `Pushed` per token → virtual balances are fully event-reconstructible; the Sluice subgraph section can drop any assumption that ship amounts are unavailable.
3. `Swapped.orderHash == strategyHash` for Aqua-mode orders → fills are linkable to strategies in the generic layer; the Sluice-specific `Filled` event still adds `makerBalanceInAfter`, which the generic layer cannot provide.
4. Mainnet deployment blocks: AquaRouter 23816437, AquaSwapVMRouter 23816440 (both 2025-11-17).
