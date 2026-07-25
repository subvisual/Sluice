# Aqua Subgraph

Generic 1inch Aqua protocol subgraph — strategies, virtual balances, maker books, fills.

## 1. What This Is

This subgraph indexes the 1inch Aqua protocol (shared liquidity layer) on Ethereum mainnet. It tracks:

- **Strategy lifecycle:** `Shipped` (open, LIVE) → `Pulled`/`Pushed` (fills, top-ups) → `Docked` (closed)
- **Per-token virtual balances:** Each strategy holds multiple tokens; balances update on every pull and push
- **Per-maker committed totals:** `MakerTokenBook.committedVirtual` sums live strategy balances, enabling over-commitment visibility
- **Fills:** SwapVM `Swapped` events linked back to their originating Aqua strategy (when the swap's `orderHash` matches a known `strategyHash`)

Mainnet deployment:

| Contract | Address | Start Block | Events |
|---|---|---|---|
| AquaRouter | `0x499943e74fb0ce105688beee8ef2abec5d936d31` | 23816437 | Shipped, Docked, Pulled, Pushed |
| AquaSwapVMRouter | `0x8fdd04dbf6111437b44bbca99c28882434e0958f` | 23816440 | Swapped |

## 2. What Is Deliberately Not Indexed

- **Reverted fills:** No transaction reverts are visible in logs. Only successful fills appear.
- **Real wallet balances:** The maker's actual token balance is not stored — use a live `eth_call` to `balanceOf(maker)` at query time.
- **PnL:** Handlers have no price data; profit/loss must be calculated off-chain.
- **Starved / contention flags:** The subgraph records the numerator (`committedVirtual`). Consumers derive the denominator (real balance) and compute over-commitment ratio = `committedVirtual` ÷ `balanceOf(maker)` off-chain.
- **Partial docks (known limitation):** `Aqua.dock()` checks the caller-supplied token list inside its loop, so a maker can dock a *subset* of a strategy's tokens (any group whose stored per-token count matches the list length) — or pass an empty list, emitting `Docked` for a still-live strategy while zeroing nothing on-chain. The `Docked` event carries no token list, so these are indistinguishable from a real full dock: the index treats the **first** `Docked` as closing the whole strategy (all balances zeroed, book decremented) and ignores repeats — along with any later `Pushed`/`Pulled` for that strategy, so the divergence stays contained to the docked strategy instead of drifting the maker's book. Only the maker can do this, and only to their own entities.
- **Re-ships with new tokens (handled):** `ship()`'s immutability check is also per-token, so re-shipping an existing hash with a disjoint token set succeeds on-chain and re-emits `Shipped` + funding `Pushed` events (observed in real Base activity). The handler ignores the repeat `Shipped` (no entity overwrite, no double-counting) and records the new tokens' funding as `SHIP_FUND` — a `Pushed` with no prior balance can only be ship funding, since `push()` to a never-funded token reverts (`PushToNonActiveStrategyPrevented`).

## 3. Entity Model

| Entity | Id | Role |
|---|---|---|
| `AquaProtocol` | "aqua" (singleton) | Global counters: total strategies, live strategies, fills, makers, apps |
| `Maker` | maker address | Maker-level counters and derived strategy/book collections |
| `App` | app address | App-level counters and derived strategy collection |
| `Token` | token address | ERC20 metadata (symbol, name, decimals) via try_-calls |
| `Strategy` | maker ++ app ++ strategyHash (hex concat) | Strategy lifecycle: status (LIVE/DOCKED), timestamps, token list, counters. Hashes are single-use per (maker, app). |
| `StrategyBalance` | strategyId ++ token | Per-strategy per-token virtual balance: current, initial (from ship funding), total pulled, total pushed |
| `MakerTokenBook` | maker ++ token | Maker's committed total: Σ virtualBalance over LIVE strategies with this token, live strategy count |
| `Fill` | txHash ++ logIndex | SwapVM fills: linked to strategy if orderHash == strategyHash, else strategy is null |
| `BalanceEvent` | txHash ++ logIndex | Audit trail: every SHIP_FUND, PULL, PUSH with the amount and resulting balance |

## 4. Example Queries

Get a maker's per-token committed balances (over-commit numerator):

```graphql
{
  makerTokenBooks(where: { maker: "0x..." }) {
    token { id symbol decimals }
    committedVirtual
    liveStrategyCount
  }
}
```

List live strategies with their balances:

```graphql
{
  strategies(where: { status: LIVE }, orderBy: shippedAt, orderDirection: desc) {
    id strategyHash app { id }
    balances { token { symbol } virtualBalance initialVirtual totalPulled }
  }
}
```

Recent fills for a specific strategy:

```graphql
{
  fills(where: { strategy: "0x..." }, orderBy: ts, orderDirection: desc, first: 20) {
    taker tokenIn { symbol } tokenOut { symbol } amountIn amountOut ts
  }
}
```

## 5. Build & Test

```bash
npm install
npm run codegen
npm run build
npm test
```

All 23 tests must pass. The continuity test verifies the invariant: `MakerTokenBook.committedVirtual == Σ(virtualBalance)` over LIVE strategies throughout a full lifecycle (ship, fill, ship again, dock).

## 6. Deploying / Other Networks

### Graph Studio

```bash
graph auth <YOUR_DEPLOY_KEY>
npm run deploy
```

Note: substitute `<YOUR_DEPLOY_KEY>` with your personal API key from Graph Studio.

### Multi-Network

Addresses are identical on 12 mainnet chains. `networks.json` currently carries `mainnet` and `base` (Base start blocks: AquaRouter 38281777, AquaSwapVMRouter 38281787). To deploy to another chain:

1. Add an entry to `networks.json` (file format: `{ "network-name": { "AquaRouter": { "address": "0x...", "startBlock": N }, "AquaSwapVMRouter": { ... } } }`).
2. Find the chain's deployment block (when Aqua was deployed to that chain; binary-search `eth_getCode` over block numbers if the explorer doesn't show it).
3. Build with: `graph build --network <network-name>` — note this rewrites `subgraph.yaml` in place; restore it to mainnet (`git checkout subgraph.yaml`) after deploying.
4. Deploy as above, to a per-network Studio subgraph (e.g. `graph deploy aqua-base`).

Base is already wired up: `npm run deploy:base` builds and deploys `aqua-base` with the `base` entry from `networks.json` in one step. It still rewrites `subgraph.yaml` in place — restore it afterwards (`git checkout -- subgraph.yaml`).

### Local fork (anvil)

Studio can't index a local fork, so `local/` carries a self-hosted stack (graph-node + IPFS + Postgres) pointed at an anvil fork of Base. Requires Docker and Foundry.

```bash
make fork-up      # start anvil fork + graph-node, deploy the subgraph from the fork block
make fork-status  # sync state + protocol counters
make fork-reset   # full teardown + fresh start — REQUIRED after any anvil restart
make fork-down    # stop everything, wipe index state
```

Query endpoint: `http://localhost:8000/subgraphs/name/sluice/aqua-local`. Override the upstream RPC with `BASE_RPC_URL=...` (defaults to the public `https://mainnet.base.org`).

Rules that keep it honest (see the F3 wiring page for why):
- The local subgraph indexes **from the fork block onward** — local activity only, never the 10M-block Base history (that path never catches up through anvil). Market/history context stays on the hosted Studio endpoints.
- **Restarting anvil silently invalidates the index** (block hashes change; the store serves plausible wrong data). Always `make fork-reset` after an anvil restart.
- Run `make fork-up` **before** sending local transactions — anything mined before the deployed start block is invisible to the index.

## 7. Querying from AI Agents (MCP)

Load The Graph MCP server at conversation start: `graphql://subgraph` resource.

Before querying a subgraph deployment:

1. Verify it is active: `get_deployment_30day_query_counts` with the subgraph's IPFS hash.
2. Query via `execute_query_by_subgraph_id` or `execute_query_by_ipfs_hash`.

**This subgraph's deployment IDs** (Graph Studio, v0.1.1):

| Network | Query endpoint | Deployment ID / IPFS hash |
|---|---|---|
| Ethereum mainnet | `https://api.studio.thegraph.com/query/1756952/aqua-mainnet/version/latest` | `QmR8hiuvthA7tRN5ViT9yLudKXZK83W8KUrD3NWeNWtGJi` |
| Base | `https://api.studio.thegraph.com/query/1756952/aqua-base/version/latest` | `QmbyrUSrTKpMLQbuxS63gF3RCRkvp4ghaGhkdM3NuGuhix` |

Network Subgraph IDs: pending publish to the decentralized network (Studio-only for now).

## 8. References

- **1inch Aqua:** [1inch/aqua on GitHub](https://github.com/1inch/aqua)
- **SwapVM:** [1inch/swap-vm on GitHub](https://github.com/1inch/swap-vm)
- **Aqua SDK:** [@1inch/aqua-sdk on npm](https://www.npmjs.com/package/@1inch/aqua-sdk) — ABI and address source of truth
- **Design spec:** `docs/superpowers/specs/2026-07-25-aqua-subgraph-design.md`
