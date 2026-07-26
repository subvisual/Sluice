# @sluice/arbitration-sdk

F2 (Verified Private Recommendations) SDK. Currently: a **strategy composer CLI** (prompt +
budget → a grammar-shaped strategy recommendation from a live 0G enclave), a one-shot **0G
inference CLI** (the Gate 0 round-trip it is built on), and an **F3 subgraph book reader** (a
maker's own Aqua book, read from The Graph).

## Subgraph book reader (F3, job 1)

Reads a maker's own book — committed per-token balances, live strategies, recent fills — from the
Aqua subgraph, and shapes it (exact decimal amounts) into what the composer's `MarketContext`
consumes. This is F3 **job 1** (the user's own book); job 2 (market depth / realised vol) comes
from composed hosted DEX/price subgraphs and is not built here.

    npm run subgraph -- meta
    npm run subgraph -- book 0x471e8aad77a1a29335081850b4e34fa7863f762a

The endpoint is a **config value, never a code assumption** (F3 §2): it defaults to the deployed
Studio **Base** subgraph (real Aqua data, no local stack) and swaps to the local fork `graph-node`
(`subgraph/local`, `make fork-up`) via `SLUICE_SUBGRAPH_URL` or `--url <endpoint>`. Only the local
fork node sees positions **we** ship on the fork.

**Wired into the composer.** `context.ts` builds a `MarketContext` whose **book (job 1) is real** —
`liveContext(maker)` reads it from the subgraph and `contextPromptBlock` renders it into the prompt
the enclave signs. Run it end-to-end with `--maker`:

    npm run compose -- "add a rangebound ETH/USDC position" --budget WETH=2,USDC=3000 --maker 0x471e8aad77a1a29335081850b4e34fa7863f762a

Without `--maker` the composer uses the stub context, exactly as before.

**Scope:** read-only, job 1 only. The market half of the context (pool depth / realised vol) is
**still a labelled stub** — job 2, F3 Open Q2 (which price subgraph). The `Recommendation`/`Template`
join (Notion F3 §3) is not in the deployed schema yet — it needs `RecommendationRegistry`, deferred
with F2 verifiability.

Modules: `subgraph.ts` (client + pure shaping), `subgraph-cli.ts`, `context.ts` (`liveContext` /
`bookToContext`).

## Strategy composer CLI

Turns a plain-language intent and a token budget into a structured `StrategyRecommendation` — a
SwapVM slot assignment for the deployed Base router (template + band/fee/curve/deadline slots +
tokens + virtual amounts) — composed by a live 0G Compute provider.

    npm run compose -- "sell my ETH if it hits 3500, all at once" --budget WETH=2
    npm run compose -- "earn fees on ETH/USDC, rangebound this week" --budget WETH=1,USDC=3000

`--budget SYM=amt,SYM=amt` (WETH, USDC) is required; `--max-strategies N`, `--max-deadline SEC`
and `--maker 0x…` (live book context, above) are optional.

**Scope — read this.** The grammar is **settled**: every instruction the model may pick is loaded
from the pinned, fork-verified opcode table (`config/opcodes.8453.json`, PR #14), so the menu
cannot drift from the venue we ship to. The deterministic **validator (I1–I12) is wired into the
compose loop** (PR #20): every well-formed attempt is gated, a violating output is fed the
failing invariants back as rejection feedback and re-inferred, bounded by `MAX_COMPOSE_ATTEMPTS`
**total attempts** (currently 2); when the attempts are spent the run falls through to the
deterministic `TEMPLATE_FALLBACK` — labelled, never presented as a model output. Book context
(F3 job 1) is live via `--maker`; without it, or when the subgraph is down, the labelled stub is
used. Still true: this path does **not** compile or ship the recommendation, nothing is committed
on-chain or persisted, and the enclave signature is recovered and surfaced (signer, `verified`,
proof URL) but **not enforced** — no registered-signer assertion, no failure on an unverified
proof.

Modules: `grammar.ts` (the settled instruction menu + the four seed templates: `full-range`,
`full-range-fee`, `banded`, `banded-fee`), `opcodes.ts` (the pinned opcode table), `swapvm.ts`
(the deterministic strategy encoder), `validate.ts` (the I1–I12 gate), `compose.ts` (prompt +
validator-driven re-infer loop), `fallback.ts` (the deterministic `TEMPLATE_FALLBACK`),
`recommendation.ts` (types + a light structural parse), `context.ts` (`liveContext` / stub),
`serve.ts` (`composeForApp` — the server facade behind the app's `POST /api/compose`, PR #30),
`compose-cli.ts`, `fund-cli.ts` (`npm run fund`, PR #22), and `fixtures.ts`/`fixtures-cli.ts`.

### Fixtures

`npm run fixtures` regenerates `config/fixtures/strategies.json`: the encoded program and
`strategyHash` for each seed template, printed with a disassembly. These are the fork-proven
shapes `grammar.test.ts` compiles every template against.

## 0G inference CLI

Runs a free-form prompt through a live 0G Compute provider (0G Galileo testnet) and prints the
answer plus a reproducible EIP-191 validation proof (recovered signer, verified verdict,
signature, and an independent proof URL).

    cp .env.example .env      # set ZG_PRIVATE_KEY to a funded Galileo testnet key (faucet.0g.ai)
    npm install
    npm run infer -- "In one sentence, what is a concentrated-liquidity strategy?"
    echo "same prompt, via stdin" | npm run infer

Exit code is `0` only when the proof verifies. Design notes:
`../../docs/features/f2-verified-private-recommendations/2026-07-25-inference-cli-design.md`.

### Funding the compute ledger

Inference bills against a prepaid on-chain ledger, not the wallet balance directly. Fund it
without burning an inference:

    npm run fund              # ensure the ledger exists (seeds ZG_DEPOSIT on first run; idempotent)
    npm run fund -- 5         # explicit top-up: deposit 5 more OG into the ledger

Both print wallet + ledger balances before and after. The wallet itself is funded from
[faucet.0g.ai](https://faucet.0g.ai).

### Config (env; defaults in `.env.example`)

`ZG_PRIVATE_KEY` (required, funded Galileo key) · `ZG_RPC` · `ZG_PROVIDER` · `ZG_MODEL` ·
`ZG_DEPOSIT`. Secrets live in the gitignored direnv `.envrc` (repo convention — run
key-dependent commands via `direnv exec`); `cp .env.example .env` also works. Never commit a key.

### Gate 0 findings (live run, 2026-07-25)

- Galileo **chainId 16602**; live chat model **`qwen/qwen2.5-omni-7b`** (provider
  `0xa48f…7836`); recovered TEE signer **`0x83df4B8E…508cF`**, stable across runs and
  independently reproducible from the proof URL. `addLedger(3)` accepted — no minimum revert.
- First-call latency ~2.2s; subsequent ~1–2.6s.
- **The 0G signature is over a provider attestation record**
  (`reqHash:respHash:centralized:aliyun:certHash`), **not** the response text — our output
  appears only as a non-reproducible hash. Verify against the signed record, never the content.
  This reshapes the on-chain binding for `RecommendationRegistry`; see ADR-0001's Gate 0 update.
- SDK gotchas: load `@0gfoundation/0g-compute-ts-sdk` via CommonJS (`createRequire`) — its ESM
  build is broken under Node 22; a fresh wallet needs `addLedger` then `acknowledgeProviderSigner`
  before the first inference; the signature endpoint lives at `{endpoint}/signature/...`
  (`getServiceMetadata().endpoint` already includes `/v1/proxy`).
