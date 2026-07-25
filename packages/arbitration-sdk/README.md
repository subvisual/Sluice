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

**Scope:** read-only, job 1 only. The `Recommendation`/`Template` join (Notion F3 §3) is not in the
deployed schema yet — it needs `RecommendationRegistry`, deferred with F2 verifiability. Not yet
wired into `context.ts`/`compose` (the composer still uses the stub `MarketContext`).

Modules: `subgraph.ts` (client + pure shaping), `subgraph-cli.ts`.

## Strategy composer CLI

Turns a plain-language intent and a token budget into a structured `StrategyRecommendation` — the
six-slot SwapVM assignment (template + slots + tokens + virtual amounts) — composed by a live 0G
Compute provider.

    npm run compose -- "sell my ETH if it hits 3500, all at once" --budget WETH=2
    npm run compose -- "earn fees on ETH/USDC, rangebound this week" --budget WETH=1,USDC=3000

`--budget SYM=amt,SYM=amt` (WETH, USDC) is required; `--max-strategies N` and `--max-deadline SEC`
are optional. Exit `0` when a well-formed recommendation parsed. One retry on malformed output.

**Scope — read this.** The output is grammar-**shaped**, not grammar-**correct**: it follows the
provisional F1 §5 menu (which has known opcode-name errors and is marked "do not build the
validator against it"), so it is **not compiled and not shippable**. There is **no verification**:
the enclave signature is received but not checked, nothing is committed on-chain, nothing is
persisted. Verifiability (`RecommendationRegistry`, the trace, the I1–I14 validator) is
deliberately out of scope for this path. Market/book context is a hardcoded stub, not live F3.

Modules: `grammar.ts` (the slot menu + templates T1–T3), `context.ts` (the stub), `compose.ts`
(prompt + round-trip), `recommendation.ts` (types + a light structural parse), `compose-cli.ts`.

## 0G inference CLI

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

### Config (env; defaults in `.env.example`)

`ZG_PRIVATE_KEY` (required, funded Galileo key) · `ZG_RPC` · `ZG_PROVIDER` · `ZG_MODEL` ·
`ZG_DEPOSIT`.

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
