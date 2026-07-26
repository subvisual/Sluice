# F3 — Market & Book Context

**Source of truth:** [F3 — Market & Book Context (The Graph)](https://app.notion.com/p/3a8caae58631812cadd9df083e8d0dd9)

The Graph. F3 builds the shared `MarketContext` object that F2's prompt consumes and the app's
portfolio view renders, from two jobs: **the user's own book** (`Position`/`Fill` indexed by a
net-new subgraph over Aqua's events — there is no existing Aqua subgraph) and **the market**
(pool depth, realised vol, fee tiers, volume — from *composed* external DEX/price subgraphs). The
old contention metrics are **parked**: most of what the old design derived was pressure for a
daemon that no longer exists.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- PRD / issues / ADRs: not yet written (`docs/prds/f3-market-book-context.md`,
  `docs/prds/f3-market-book-context-issues.md`, and `adr/` here do not exist yet).
- **Generic Aqua subgraph** (Notion §2's shipped artifact): `subgraph/` — deployed to Graph
  Studio on Ethereum mainnet and Base (v0.1.2, Studio-only, not on the decentralized network).
  Endpoints, deployment IDs, entity model: `subgraph/README.md`.
- **Local fork indexing stack**: `subgraph/local/` (graph-node + IPFS + Postgres against an
  anvil fork of Base) — `make fork-up` / `fork-status` / `fork-reset` / `fork-down` from
  `subgraph/`. Always `fork-reset` after an anvil restart.
- **SDK reader (job 1)**: `packages/arbitration-sdk/src/subgraph.ts` (+ `subgraph-cli.ts`) —
  defaults to the deployed Studio Base endpoint; `SLUICE_SUBGRAPH_URL` swaps it to the local
  fork node. Feeds `MarketContext.userBook` via `context.ts` (`source: "stub" | "subgraph"`).
  Job 2 (pair context — `realizedVol` etc.) is still a labelled hardcoded stub, blocked on
  Notion Open Q2.

Subgraphs index successful transactions only. Reverts emit no logs, so any pressure metric is
**derived/inferred**, never indexed — label it as such. `liveBalance` comes from a live `eth_call`
at the snapshot block, never from the index (the user is about to sign; freshness matters). Never
claim we index reverts or mempool data.

The Sluice-keyed deliverable indexes `AquaSwapVMRouter`'s lifecycle events filtered to our
strategies, plus `RecommendationCommitted` from our registry, and joins the two on
`strategyHash` — we have no app in the ship path to emit from. (The shipped generic subgraph
in `subgraph/` deliberately filters nothing — all makers, all apps; the Sluice-keyed join
remains the F3 deliverable.) **Never key `Position` on the bare
hash:** `strategyHash = keccak256(strategy)` has no maker in the preimage, so two users composing
identical bytes collide. Key on `(maker, app, strategyHash)` and join per `(maker, strategyHash)`.
The ship event carries the full strategy bytes, so the subgraph can store the bytecode itself.
