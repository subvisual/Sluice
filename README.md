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
  authored through a settled template **grammar** an LLM can safely fill, then **compiled**
  deterministically to SwapVM bytecode. A forge script (`contracts/script/Take.s.sol`) driving a
  funded EOA produces the fills a fork otherwise lacks.
- **0G** — private recommendations. Composition runs inside an Intel TDX enclave and is signed;
  recovering the signer proves **provenance** (a real 0G TEE produced it). Review splits by what
  has a right answer: a deterministic validator **rejects** non-compliant recommendations and
  re-infers (never rewriting a signed one), while a **reviewer agent** (a stretch) judges what
  does not — risk rating, intent match, band sensibility.
- **The Graph** — market & book context. A net-new subgraph indexes the user's own Aqua book
  (`Position`/`Fill`); composed external subgraphs supply market data (depth, realised vol, fees).
  Together they form the `MarketContext` the recommendation is built from.

## Status

Hackathon build, pre-alpha. Nothing here is audited; don't point it at real funds.

Running so far:

- A **generic 1inch Aqua subgraph** — the first that exists — live on Ethereum mainnet and Base
  against real protocol activity, plus a local fork stack (`subgraph/`).
- The **composer** in `packages/arbitration-sdk`: `npm run compose` turns intent + budget into a
  recommendation from a live 0G enclave, with the deterministic I1–I12 validator wired into a
  reject-and-re-infer loop and a labelled `TEMPLATE_FALLBACK` when attempts are exhausted. Four
  templates (full-range, full-range-fee, banded, banded-fee) compile to SwapVM bytecode and are
  fixture-proven — shipped **and** filled on the Base fork. Alongside: the one-shot
  `npm run infer` CLI (signed EIP-191 proof) and the `npm run fund` ledger CLI.
- **Foundry contracts** (`contracts/`): `SluiceStrategy.sol`, ship/take scripts, three fork test
  suites against the deployed Aqua/SwapVM.
- The **Next.js app** (`packages/app`): the compose screen behind a real `POST /api/compose` —
  signed `ENCLAVE` recommendations when the server holds a funded 0G key, `TEMPLATE_FALLBACK`
  otherwise. (Risk rating itself arrives with the deferred reviewer agent.) Wallet connect is
  **Reown AppKit** (multi-wallet), and a header dropdown switches the app's read path between the
  local fork and Base mainnet — a read-path selector only, never the mainnet guard.

The venue is a **Base fork** sharing Base's chainId, so a wrong-network mistake looks perfectly
correct — guarded by a fork probe plus an explicit `SLUICE_ALLOW_MAINNET` opt-in, with addresses
pinned in `config/addresses.8453.json`.

## Run it

One command brings up the whole thing — a Base fork at the pinned block, a
graph-node indexing it, a wallet funded with 100 ETH / 10 WETH / 1000 USDC /
1 cbBTC and pre-approved to Aqua, and the app at
[localhost:3000](http://localhost:3000) with that wallet already connected:

```bash
scripts/demo-up.sh          # needs foundry, docker compose v2, node, jq
scripts/demo-down.sh        # stops all three: app, fork, index
```

Ctrl-C stops only the app and leaves the fork and the index up, so what you
shipped survives a restart of the UI. `demo-down.sh` stops the lot, and works
from any shell — `demo-up.sh` leaves the app's pid in a file for it, the same
way `fork-up.sh` leaves anvil's.
Composition needs `ZG_PRIVATE_KEY` in `packages/app/.envrc` and a funded 0G
ledger — without either it still answers, labelled `TEMPLATE_FALLBACK`.

To make a shipped strategy actually fill, drive a taker over it:
`node scripts/fork-take.mjs --maker <address> --in USDC --amount 200`.

## Documentation

**Notion is the source of truth** for the concept, the plan and every schema; this repo is
the implementation. The page index and the precedence rule live in
[CLAUDE.md](CLAUDE.md).

Local docs are organised by the same four features as Notion:

| | |
| --- | --- |
| [F1 — Aqua & the Strategy VM](docs/features/f1-aqua-strategy-vm/README.md) | Aqua + SwapVM: the fork venue, the slot grammar, the compiler, the taker |
| [F2 — Private Recommendations](docs/features/f2-private-recommendations/README.md) | 0G: sealed inference, signed recommendations, validator |
| [F3 — Market & Book Context](docs/features/f3-market-book-context/README.md) | The Graph: the user's book subgraph + composed market context |
| [Wiring & Delivery](docs/features/wiring-delivery/README.md) | Shared vocabulary, the per-user request flow, transaction shape, demo |

PRDs and issue files live in [docs/prds/](docs/prds/README.md).

## A note on language

- **Recommendation** → compiles to one or more **Positions**; one recommendation is one user
  signature over a `Multicall`.
- The **over-committed book / "fillability"** framing is parked future work, not the current
  product. So is **"headroom"** and its cousins (`balanceFloor`, `largestAllOrNothingDraw`,
  `exposureHeadroom`) — using them unqualified is a real bug.
