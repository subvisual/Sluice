# Sluice

Strategy Composer for 1inch Aqua. ETHGlobal Lisbon 2026.

## What Sluice is

SwapVM strategies are security-critical bytecode (`[opcode_index][args_length][args_data]`) that
almost nobody can safely author, and an Aqua strategy is **immutable once shipped** — the only exit
is `dock()` (or a `_deadline` unwind). Sluice is a **creation-time composer** that closes that gap:
you give it a plain-language intent and a budget of tokens you already hold, and it returns concrete,
risk-rated Aqua/SwapVM strategy **recommendations**. You review them and sign **one** `Multicall`
that ships them. Tokens never leave your wallet; you are the maker.

Sluice acts **once, at creation time**. It is **not** in the per-swap path and **not** a daemon
managing a book afterwards — there is no tick loop, no epoch, nothing watching your positions once
you have signed. (Two extensions are parked, with *different* blockers: **whole-balance
composition** waits on the sizing maths that keeps all-or-nothing legs coverable; **continuous
management** waits on an authorization problem — session keys / smart accounts — not an agent
problem.) Every recommendation
is computed privately in a 0G TDX enclave and signed; the signature is verified on-chain to prove
**provenance** (a real 0G TEE produced it, our committer authorised it), then a deterministic
validator **rejects** non-compliant recommendations and re-infers — it never rewrites a signed one,
and refusals stay on the record.

Three load-bearing integrations — remove any and the project stops making sense:
**1inch Aqua + SwapVM** (the venue, the strategy grammar, the compiler, the taker), **0G**
(private signed recommendations + encrypted trace), **The Graph** (the user's book + market context,
derived off-chain). The concept page is the argument and holds no implementation detail —
feature pages do.

## Source of truth

**Notion is the source of truth for the concept, the plan, and every schema.** This repo is
the implementation. When a local document and Notion disagree, **Notion wins** — fix the
local document, don't argue with it in code.

Read the relevant Notion page **before** planning, designing, or grilling anything. Use the
Notion MCP (`notion-fetch` with the page URL). Don't work from a summary in this repo when
the page itself is one fetch away.

| Page | Covers |
| --- | --- |
| [Sluice — Strategy Composer for 1inch Aqua](https://app.notion.com/p/3a7caae5863181e685dec2690a6eed83) | The concept and the argument. Start here. |
| [F1 — Aqua & the Strategy VM](https://app.notion.com/p/3a8caae5863181459491dcb6e7e25a1b) | 1inch Aqua + SwapVM: the fork venue, the slot grammar, the compiler, the taker. |
| [F2 — Verified Private Recommendations](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b) | 0G: sealed TEE inference, signed recommendations, validator + reviewer, encrypted trace. |
| [F3 — Market & Book Context](https://app.notion.com/p/3a8caae58631812cadd9df083e8d0dd9) | The Graph: the user's own book subgraph + composed market context. |
| [Wiring & Delivery](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe) | Shared vocabulary, per-user request flow, transaction shape, gates, demo. |
| [Prize Strategy](https://app.notion.com/p/3a7caae5863181209c77ca7d889bbb64) | Sponsor targeting and prize math. |
| [Build Spec §0](https://app.notion.com/p/3a7caae5863181428dbfdcb0225923d3) | Protocol mechanics from the Aqua source. **§0 only** — the rest is superseded. |

Two rules that follow:

- **Don't restate Notion here.** Local docs link to a page and add only what is
  implementation-specific (file paths, addresses, local commands).
- **Decisions made while building go back to Notion**, on the feature page they belong to —
  not only into a local ADR. A decision that exists only in this repo will be missed.

The three features are independent enough to build in parallel. The only shared context
lives on the Wiring page.

## Vocabulary that has already burned this project

- **Recommendation** (one enclave-signed payload, ≥1 strategies, one nonce, `id = keccak256(signedText)`)
  → compiles to one or more **Positions** (one shipped strategy on-chain, keyed by `strategyHash`).
  One recommendation → N strategies → N positions → one `Multicall` → **one** user signature.
- **Slot assignment** is the model's structured output (six ordered slots); it is **never** raw
  bytecode. The deterministic compiler turns it into SwapVM bytecode.
- The over-committed-book / "fillability" / `balanceFloor` / `largestAllOrNothingDraw` /
  `exposureHeadroom` vocabulary is **parked** — it belongs only to the future whole-balance mode.
  Reintroducing it unqualified is a known bug returning.

## Protocol facts, read from source

From [1inch/aqua](https://github.com/1inch/aqua). Each is easy to get wrong by inference; detail is
on Notion F1.

- **`strategyHash = keccak256(strategy)`** (`Aqua.sol:41`) — raw bytes, no `abi.encode`, no maker.
  Computable before shipping, and it **collides across makers**: key on `(maker, app, strategyHash)`.
- **Emit a `Salt` (`0x02`) in every strategy.** A docked hash is burned permanently and amounts are
  not in the preimage, so a "resize" is a new strategy, never a re-ship.
- **We deploy no Aqua app.** `ship()` keys the maker on `msg.sender`, so routing through a contract
  of ours would make it the maker for every user.
- **Virtual amounts are a ceiling, not a promise.** Never draw more than the user authorised.

## Stack & layout

No code scaffolded yet beyond `packages/arbitration-sdk` (0G inference client + CLI); the toolchain
below is intended (from `.gitignore` + Notion Wiring §1). Planned monorepo:
`packages/` (arbitration-sdk, taker, sluice-app, dashboard) · `contracts/` · `subgraph/` ·
`config/addresses.<chainId>.json`.

- **Contracts** — Hardhat (Ignition deploys, typechain) + Foundry (`forge`, forge-std)
- **Subgraph** (F3) — The Graph, codegen into `subgraph/generated/`
- **Agent / dashboard** — TypeScript/Node (dashboard is Next.js)

**For now, development and testing run against a Base mainnet fork** at a pinned block, so we build
against the real deployed Aqua/SwapVM rather than a copy. We self-deploy only our own contracts
(taker, `RecommendationRegistry`); addresses are pinned in `config/addresses.8453.json`. A fork
shares Base's chainId, so guard signing with a fork probe (`anvil_nodeInfo` — **not `eth_getCode`**,
which returns identical bytecode either way) plus an explicit `SLUICE_ALLOW_MAINNET` opt-in.

This repo signs transactions — keys live in `.env` (gitignored); never
commit one. Two keys: `SLUICE_COMMITTER_KEY` (commits recommendations) and `SLUICE_OWNER_KEY`
(registry admin, cold). The user is the maker and signs the ship `Multicall` themselves.

## Agent skills

### Domain docs

Single-context, organised by feature. See `docs/agents/domain.md`.

### PRDs and issues

PRDs live in `docs/prds/<feature>.md`; issue files in `docs/prds/<feature>-issues.md`,
using the feature slugs in `docs/features/`. See `docs/agents/prds.md`.
