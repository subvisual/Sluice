# Sluice

Fillability layer for over-committed 1inch Aqua books. ETHGlobal Lisbon 2026.

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

## Agent skills

### Domain docs

Single-context, organised by feature. See `docs/agents/domain.md`.

### PRDs and issues

PRDs live in `docs/prds/<feature>.md`; issue files in `docs/prds/<feature>-issues.md`,
using the feature slugs in `docs/features/`. See `docs/agents/prds.md`.
