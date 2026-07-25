# @sluice/arbitration-sdk

F2 (Verified Private Recommendations) SDK. Currently: a one-shot **0G Compute inference CLI** —
the first runnable slice of the 0G integration — plus the Gate 0 spike.

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
