# Sluice

Fillability layer for over-committed 1inch Aqua books. ETHGlobal Lisbon 2026.

## What Sluice is

1inch Aqua lets one approved wallet balance back several strategies at once, so a book can
be **over-committed** — e.g. 2.5× virtual commitment against 1× real capital. That is free
capital efficiency until concurrent draws exceed the real balance: the losing `pull()`
reverts, the taker's swap fails, they burn gas for nothing. Nobody goes insolvent (no
escrow, no bad debt) — what degrades is **fillability**: the book becomes quotes that don't
fill. A `quote()` can price perfectly in the same block its `swap()` reverts, so no
pre-trade check closes the gap; the only fix is managing the shipped set so it rarely opens.

Sluice is the agent that does that. You declare strategies + a risk mandate; it decides
which are live and at what virtual size, and resizes as fills consume real balance. **It is
never in the per-swap path** — its only levers are `ship()`, `dock()`, and ship amounts. It
manages the book, not the trades. Every decision is computed privately in a 0G TDX enclave,
signed, verified on-chain, then passed or **rejected** by a deterministic mandate gate the
model can't talk past (rejected attempts are kept on the record, not rewritten).

Three load-bearing integrations — remove any and the project stops making sense:
**1inch Aqua + SwapVM** (the book), **0G** (private signed decisions + encrypted trace),
**The Graph** (contention *derived* off-chain, since reverts emit no logs). The concept
page is the argument and holds no implementation detail — feature pages do.

## Source of truth

**Notion is the source of truth for the concept, the plan, and every schema.** This repo is
the implementation. When a local document and Notion disagree, **Notion wins** — fix the
local document, don't argue with it in code.

Read the relevant Notion page **before** planning, designing, or grilling anything. Use the
Notion MCP (`notion-fetch` with the page URL). Don't work from a summary in this repo when
the page itself is one fetch away.

| Page | Covers |
| --- | --- |
| [Sluice — Fillability Layer](https://app.notion.com/p/3a7caae5863181e685dec2690a6eed83) | The concept and the argument. Start here. |
| [F1 — The Over-Committed Book](https://app.notion.com/p/3a8caae5863181459491dcb6e7e25a1b) | 1inch Aqua + SwapVM: self-deployment, strategies, the taker. |
| [F2 — Verified Private Decisions](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b) | 0G: sealed TEE inference, signed decisions, encrypted trace. |
| [F3 — The Agent's Eyes](https://app.notion.com/p/3a8caae58631812cadd9df083e8d0dd9) | The Graph: subgraph and derived contention metrics. |
| [Wiring & Delivery](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe) | Shared vocabulary, tick loop, transaction shape, schedule, demo. |
| [Prize Strategy](https://app.notion.com/p/3a7caae5863181209c77ca7d889bbb64) | Sponsor targeting and prize math. |
| [Build Spec §0](https://app.notion.com/p/3a7caae5863181428dbfdcb0225923d3) | Protocol mechanics from the Aqua source. **§0 only** — the rest is superseded. |

Two rules that follow:

- **Don't restate Notion here.** Local docs link to a page and add only what is
  implementation-specific (file paths, addresses, local commands).
- **Decisions made while building go back to Notion**, on the feature page they belong to —
  not only into a local ADR. A decision that exists only in this repo will be missed.

The three features are independent enough to build in parallel. The only shared context
lives on the Wiring page.

## Stack & layout

No code scaffolded yet — toolchain below is intended (from `.gitignore` + Notion Wiring §1),
so there are no build/test commands until a feature is scaffolded. Planned monorepo:
`packages/` (arbitration-sdk, taker, sluice-app, dashboard) · `contracts/` · `subgraph/` ·
`config/addresses.<chainId>.json`.

- **Contracts** — Hardhat (Ignition deploys, typechain) + Foundry (`forge`, forge-std)
- **Subgraph** (F3) — The Graph, codegen into `subgraph/generated/`
- **Agent / dashboard** — TypeScript/Node (dashboard is Next.js)

`ignition/deployments/` is **deliberately committed** — the self-deployed Aqua addresses are
the hour-0 gate the whole team needs. Never hardcode mainnet Aqua addresses (identical across
12 chains); assert `chainId` at startup and before every tx. This repo signs transactions —
keys live in `.env` (gitignored); never commit one.

## Agent skills

### Domain docs

Single-context, organised by feature. See `docs/agents/domain.md`.

### PRDs and issues

PRDs live in `docs/prds/<feature>.md`; issue files in `docs/prds/<feature>-issues.md`,
using the feature slugs in `docs/features/`. See `docs/agents/prds.md`.
