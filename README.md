# 🚰 Sluice

**The fillability layer for over-committed shared liquidity.** ETHGlobal Lisbon 2026.

1inch Aqua lets tokens stay in your wallet: you approve your full balance and multiple
strategies draw against that same balance at once. Ship three strategies against 10,000 USDC
and you can have 25,000 of virtual balance committed against 10,000 of real capital. Aqua's
own README notes there is no over-commitment protection at the core level.

Nobody goes insolvent when you exceed it — there is no escrow and no bad debt. The losing
`pull()` simply reverts, the taker's swap fails, and they burn gas for nothing. What
degrades is the **maker's book**: it stops being liquidity and becomes a set of quotes that
don't fill. And no amount of pre-trade checking closes the gap, because SwapVM's `quote()`
can succeed in the same block that `swap()` reverts — a quote is advisory, not a promise.

> **Sluice** is an agent that keeps your Aqua book as over-committed as it can profitably
> get, without letting your quotes stop filling.

You declare strategies and a risk mandate. Sluice decides which strategies are live and at
what virtual balance, then resizes continuously as fills consume real balance. Fills are
taker-driven and atomic, so the agent is never in the per-swap path — its levers are
`ship()`, `dock()`, and the amounts it ships with. It manages the book, not the trades.

## How it works

Three integrations, each load-bearing:

- **1inch Aqua + SwapVM** — the venue. A deliberately over-subscribed book of
  concentrated-liquidity strategies, all backed by one approved balance. Resizing is a
  single atomic `Multicall` of `dock()` + `ship()`.
- **0G** — private, verifiable decisions. The allocation policy runs inside an Intel TDX
  enclave, which signs each response over `(request, response)`; the chain verifies that
  with `ecrecover` against a registered enclave key. A deterministic mandate gate then
  **rejects** non-compliant decisions and re-infers — it never rewrites a signed one.
  Decision traces live encrypted in 0G Storage, so the owner can audit why their capital
  moved.
- **The Graph** — the agent's eyes. Our own subgraph indexes the book's events; contention
  is **derived** off-chain from those facts, because a reverted fill emits no logs and can
  never be indexed.

Accounting is **per token**, not price-normalised: `pull()` reverts on the specific token
that ran out, so a healthy-looking aggregate can hide an empty USDC leg.

## Status

Hackathon build, pre-alpha. Nothing here is audited; don't point it at real funds.

**There is no official Aqua testnet deployment**, so hour 0 is self-deploying `AquaRouter` +
`AquaSwapVMRouter` ourselves, and it gates everything downstream. The mainnet addresses in
circulation are identical across 12 chains, which makes a wrong-network mistake look
perfectly correct — so addresses are pinned in one config file and `chainId` is asserted at
startup and before every transaction.

## Documentation

**Notion is the source of truth** for the concept, the plan and every schema; this repo is
the implementation. The page index and the precedence rule live in
[CLAUDE.md](CLAUDE.md).

Local docs are organised by the same four features as Notion:

| | |
| --- | --- |
| [F1 — The Over-Committed Book](docs/features/f1-over-committed-book/README.md) | Aqua + SwapVM: deployment, strategies, the taker |
| [F2 — Verified Private Decisions](docs/features/f2-verified-private-decisions/README.md) | 0G: sealed inference, signed decisions, encrypted trace |
| [F3 — The Agent's Eyes](docs/features/f3-agents-eyes/README.md) | The Graph: subgraph and derived contention metrics |
| [Wiring & Delivery](docs/features/wiring-delivery/README.md) | Shared vocabulary, tick loop, transaction shape, demo |

PRDs and issue files live in [docs/prds/](docs/prds/README.md).

## A note on language

Two words this project has already been burned by, kept precise on purpose:

- It is a **fillability** layer, not a solvency layer. Aqua cannot go insolvent.
- **"Headroom"** is never used unqualified. It is one of `balanceFloor`,
  `largestAllOrNothingDraw`, or `exposureHeadroom` — collapsing them is a real bug.
