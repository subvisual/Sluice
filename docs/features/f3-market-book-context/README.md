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

- PRD: `docs/prds/f3-market-book-context.md`
- Issues: `docs/prds/f3-market-book-context-issues.md`
- Feature-scoped ADRs: `docs/features/f3-market-book-context/adr/`

Subgraphs index successful transactions only. Reverts emit no logs, so any pressure metric is
**derived/inferred**, never indexed — label it as such. `liveBalance` comes from a live `eth_call`
at the snapshot block, never from the index (the user is about to sign; freshness matters). Never
claim we index reverts or mempool data.

Index Aqua's own events filtered by `app`, and join them to `RecommendationCommitted` on
`strategyHash` — we have no app in the ship path to emit from. **Never key `Position` on the bare
hash:** `strategyHash = keccak256(strategy)` has no maker in the preimage, so two users composing
identical bytes collide. Key on `(maker, app, strategyHash)` and join per `(maker, strategyHash)`.
The ship event carries the full strategy bytes, so the subgraph can store the bytecode itself. No
Aqua event has `indexed` fields — fine here, but the `eth_getLogs` fallback cannot filter by maker
at the node.
