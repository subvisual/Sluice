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
is computed privately in a 0G TDX enclave and signed — recovering the signer proves
**provenance** (a real 0G TEE produced it) — then a deterministic
validator **rejects** non-compliant recommendations and re-infers — it never rewrites a signed one,
and refusals stay on the record.

Three load-bearing integrations — remove any and the project stops making sense:
**1inch Aqua + SwapVM** (the venue, the strategy grammar, the compiler, the taker), **0G**
(private signed recommendations), **The Graph** (the user's book + market context,
derived off-chain). The concept holds no implementation detail — the feature docs do.

## Documentation

The concept, the plan, and every schema live in `docs/`; this repo is the implementation.
Read the relevant feature doc **before** planning, designing, or grilling anything.

| Doc | Covers |
| --- | --- |
| [F1 — Aqua & the Strategy VM](docs/features/f1-aqua-strategy-vm/README.md) | 1inch Aqua + SwapVM: the fork venue, the slot grammar, the compiler, the taker. |
| [F2 — Private Recommendations](docs/features/f2-private-recommendations/README.md) | 0G: sealed TEE inference, signed recommendations, validator + reviewer. |
| [F3 — Market & Book Context](docs/features/f3-market-book-context/README.md) | The Graph: the user's own book subgraph + composed market context. |
| [Wiring & Delivery](docs/features/wiring-delivery/README.md) | Shared vocabulary, per-user request flow, transaction shape, gates, demo. |

The three features are independent enough to build in parallel. The only shared context
lives on the Wiring & Delivery doc.

## Vocabulary that has already burned this project

- **Recommendation** (one enclave-signed payload, ≥1 strategies, one nonce, `id = keccak256(signedText)`)
  → compiles to one or more **Positions** (one shipped strategy on-chain, keyed by `strategyHash`).
  One recommendation → N strategies → N positions → one `Multicall` → **one** user signature.
- **Slot assignment** is the model's structured output — a template pick (`full-range`,
  `full-range-fee`, `banded`, `banded-fee`) plus its slot fields (curve, optional band/fee
  params, deadline, virtual amounts); it is **never** raw bytecode. The old six-ordered-slots
  grammar could not be built against the deployed router (PR #15) — do not reintroduce it. The
  deterministic compiler owns bytes, ordering and `SALT`.
- The over-committed-book / "fillability" / `balanceFloor` / `largestAllOrNothingDraw` /
  `exposureHeadroom` vocabulary is **parked** — it belongs only to the future whole-balance mode.
  Reintroducing it unqualified is a known bug returning.

## Protocol facts, read from source

From [1inch/aqua](https://github.com/1inch/aqua). Each is easy to get wrong by inference; detail is
in the F1 doc.

- **`strategyHash = keccak256(strategy)`** (`Aqua.sol:41`) — but the `strategy` bytes we ship **are
  `abi.encode(Order{maker, traits, program})`**, so effectively `keccak256(abi.encode(order))`; the
  bare program is never hashed (fork-verified, PR #14 / `StrategyHashSemantics.t.sol`). Aqua's hash
  has **no maker in the preimage**, so identical **bytes** collide across makers — **key on
  `(maker, app, strategyHash)`** (required: the same hash can hold N live rows). But a SwapVM
  Aqua-mode strategy embeds the maker in those bytes, so identical **programs** from different makers
  do **not** collide. Computable before shipping.
- **Emit a `SALT` instruction in every strategy.** Opcode numbers are **data**, not prose: the
  deployed Base router differs from the 1inch master source (deployed `SALT` is `0x15`, not the
  master's `0x02`), so read them from `config/opcodes.8453.json` (pinned + fork-verified, PR #14),
  never the master table. A docked hash is burned permanently and amounts are not in the preimage,
  so a "resize" is a new strategy, never a re-ship.
- **We deploy no Aqua app.** `ship()` keys the maker on `msg.sender`, so routing through a contract
  of ours would make it the maker for every user.
- **Virtual amounts are a ceiling, not a promise.** Never draw more than the user authorised.

## Stack & layout

Monorepo (npm workspaces):

- **`packages/arbitration-sdk`** — the composer: 0G sealed inference, the deterministic I1–I12
  validator wired into a reject-and-re-infer loop, the SwapVM compiler + fork-proven fixtures,
  the serve facade behind `/api/compose`, the F3 subgraph book reader, and the
  `infer`/`compose`/`subgraph`/`fund` CLIs
- **`packages/app`** — Next.js compose screen + `POST /api/compose` (bundles the SDK; the 0G key
  stays server-side). Wallet connect is **Reown AppKit**, which pins the app to **wagmi 2.x** (the
  adapter does not support wagmi 3 — don't bump it). The header dropdown switches the **read path**
  between the local fork and Base mainnet via a `sluice-rpc` cookie (server-readable — SSR and
  client must agree); it is **not a mainnet guard**
- **`contracts/`** — Foundry only (no Hardhat): `SluiceStrategy.sol`, `Ship.s.sol`/`Take.s.sol`,
  three fork test suites. The taker is `contracts/script/Take.s.sol` driving a funded EOA —
  deliberately **no taker contract**
- **`subgraph/`** — The Graph, codegen into `subgraph/generated/`; deployed to Ethereum mainnet +
  Base (Studio), with a local fork stack in `subgraph/local`
- **`config/`** — `addresses.8453.json` (pinned addresses + fork block), `opcodes.8453.json`
  (pinned opcode table)

**For now, development and testing run against a Base mainnet fork** at a pinned block, so we build
against the real deployed Aqua/SwapVM rather than a copy. We self-deploy only our own contracts
(today `SluiceStrategy.sol` — no taker contract);
addresses are pinned in `config/addresses.8453.json`. A fork
shares Base's chainId, so guard signing with a fork probe (`anvil_nodeInfo` — **not `eth_getCode`**,
which returns identical bytecode either way) plus an explicit `SLUICE_ALLOW_MAINNET` opt-in.

This repo signs transactions — secrets live in direnv `.envrc` files (`packages/app/.envrc`,
`packages/arbitration-sdk/.envrc`), all gitignored; never commit one. The only key any code reads
today is `ZG_PRIVATE_KEY` (funded 0G Galileo key).
The user is the maker and signs the ship `Multicall` themselves.

## Agent skills

### Domain docs

Single-context, organised by feature. See `docs/agents/domain.md`.

### PRDs and issues

PRDs live in `docs/prds/<feature>.md`; issue files in `docs/prds/<feature>-issues.md`,
using the feature slugs in `docs/features/`. See `docs/agents/prds.md`.
