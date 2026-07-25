# 🚰 Sluice

**A strategy composer for 1inch Aqua.** ETHGlobal Lisbon 2026.

1inch Aqua's SwapVM lets you ship programmable market-making strategies as bytecode
(`[opcode_index][args_length][args_data]`). That is powerful and almost nobody can author it
safely — and once a strategy is shipped it is **immutable**; the only exit is `dock()` or a
`_deadline` unwind. There is no patching a bad strategy after the fact.

> **Sluice** turns a plain-language intent plus a budget you already hold into concrete,
> risk-rated Aqua strategy recommendations you review and ship in a single signature.

You describe what you want and select the tokens/amounts you're willing to commit. Sluice composes
one or more strategies, checks them with deterministic code, and presents them; you sign **one**
`Multicall` that ships them. Tokens never leave your wallet — **you are the maker**. Sluice acts
once, at creation time: it is never in the per-swap path and does not manage your positions
afterwards.

## How it works

Three integrations, each load-bearing:

- **1inch Aqua + SwapVM** — the venue and the language. We run against a **Base mainnet fork** at a
  pinned block (real, already-deployed Aqua), self-deploying only our own contracts. Strategies are
  authored through a fixed six-slot **grammar** an LLM can safely fill, then **compiled**
  deterministically to SwapVM bytecode. A `SluiceTaker` produces the fills a fork otherwise lacks.
- **0G** — private, verifiable recommendations. Composition runs inside an Intel TDX enclave and is
  signed; the chain verifies the signature to prove **provenance** (a real 0G TEE produced it, our
  committer authorised it). A deterministic validator **rejects** non-compliant recommendations and
  re-infers — it never rewrites a signed one. Traces live encrypted in 0G Storage for audit.
- **The Graph** — market & book context. A net-new subgraph indexes the user's own Aqua book
  (`Position`/`Fill`); composed external subgraphs supply market data (depth, realised vol, fees).
  Together they form the `MarketContext` the recommendation is built from.

## Status

Hackathon build, pre-alpha. Nothing here is audited; don't point it at real funds.

Running so far: the **0G inference CLI** in `packages/arbitration-sdk` (`npm run infer -- "…"`),
which runs a prompt on a live 0G provider and prints the answer plus a verifiable EIP-191 proof.

The venue is a **Base fork** sharing Base's chainId, so a wrong-network mistake looks perfectly
correct — guarded by a fork probe plus an explicit `SLUICE_ALLOW_MAINNET` opt-in, with addresses
pinned in `config/addresses.8453.json`.

## Documentation

**Notion is the source of truth** for the concept, the plan and every schema; this repo is
the implementation. The page index and the precedence rule live in
[CLAUDE.md](CLAUDE.md).

Local docs are organised by the same four features as Notion:

| | |
| --- | --- |
| [F1 — Aqua & the Strategy VM](docs/features/f1-aqua-strategy-vm/README.md) | Aqua + SwapVM: the fork venue, the slot grammar, the compiler, the taker |
| [F2 — Verified Private Recommendations](docs/features/f2-verified-private-recommendations/README.md) | 0G: sealed inference, signed recommendations, validator, encrypted trace |
| [F3 — Market & Book Context](docs/features/f3-market-book-context/README.md) | The Graph: the user's book subgraph + composed market context |
| [Wiring & Delivery](docs/features/wiring-delivery/README.md) | Shared vocabulary, the per-user request flow, transaction shape, demo |

PRDs and issue files live in [docs/prds/](docs/prds/README.md).

## A note on language

- **Recommendation** → compiles to one or more **Positions**; one recommendation is one user
  signature over a `Multicall`.
- The **over-committed book / "fillability"** framing is parked future work, not the current
  product. So is **"headroom"** and its cousins (`balanceFloor`, `largestAllOrNothingDraw`,
  `exposureHeadroom`) — using them unqualified is a real bug.
