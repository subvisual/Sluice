# Domain Docs

How the building skills should consume this repo's domain documentation.

This repo is **single-context**, organised **by feature**. Notion has **three** features
(F1/F2/F3) plus **Wiring & Delivery**, the shared context that connects them — see the table in
`CLAUDE.md`.

## Notion first

**Notion is the source of truth** for the concept, plan and schemas. Before exploring the
codebase for a task, fetch the Notion page for the feature you're working in (`notion-fetch`
with the URL from `docs/features/<slug>/README.md`). Local docs are pointers and
implementation detail, never a replacement.

If a local document contradicts Notion, Notion wins — say so and fix the local document.

## Then read these

- **`CONTEXT.md`** at the repo root — the ubiquitous language, local mirror of the
  vocabulary defined on the Wiring page
- **`docs/adr/`** — cross-cutting architectural decisions
- **`docs/features/<slug>/`** — the feature's local index and its feature-scoped ADRs

If any of these don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when
terms or decisions actually get resolved.

## File structure

```
/
├── CLAUDE.md                              ← Notion index + agent skills config
├── CONTEXT.md                             ← ubiquitous language
├── docs/
│   ├── adr/                               ← cross-cutting decisions
│   ├── agents/                            ← this file + prds.md
│   ├── features/
│   │   ├── f1-aqua-strategy-vm/
│   │   │   ├── README.md                  ← Notion link + local scope
│   │   │   └── adr/                       ← feature-scoped decisions
│   │   ├── f2-private-recommendations/
│   │   ├── f3-market-book-context/
│   │   └── wiring-delivery/
│   └── prds/                              ← <slug>.md + <slug>-issues.md
├── packages/                              ← arbitration-sdk (composer/SDK), app (Next.js)
├── contracts/                             ← Foundry: fork venue, ship/take scripts, tests
├── subgraph/                              ← generic Aqua subgraph + local fork stack
└── config/                                ← pinned addresses + opcode tables
```

A decision that touches only one feature belongs in that feature's `adr/`. A decision that
changes how features connect — the request flow, the transaction shape, the shared vocabulary
— belongs in `docs/adr/` **and** on the Wiring page in Notion.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a
hypothesis, a test name), use the term as defined in `CONTEXT.md` and on the Wiring page.
Don't drift to synonyms the glossary explicitly avoids — this project has already been
burned by imprecise language:

- Sluice is a **strategy composer**, not a book manager or trading bot — it acts once at
  creation time. The "fillability layer / over-committed book" framing is **parked** future work.
- A **recommendation** compiles to one or more **positions**; it is one user signature over a
  `Multicall`. The parked vocabulary (`balanceFloor`, `largestAllOrNothingDraw`,
  `exposureHeadroom`, unqualified "headroom") belongs only to the future whole-balance mode.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing
language the project doesn't use (reconsider) or there's a real gap (note it for
`/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR or a decision recorded in Notion, surface it
explicitly rather than silently overriding:

> _Contradicts ADR-0007 (validator rejects, never mutates) — but worth reopening because…_
