# F2 — Private Recommendations · Build Plan

Implementation plan for F2 under the **Strategy Composer** framing. **Notion is the source of
truth** for the concept and schemas ([F2 page](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b),
[Wiring](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe)); this file is the local,
implementation-specific build-out (files, signatures, sequence, tests). Regenerated 2026-07-25
after the pivot from the old daemon design; the previous version is in git history.

> **Build status (2026-07-26).** The loop is live: *prompt → validated recommendation*. **Built**
> (merged): the strategy composer (`packages/arbitration-sdk`, `compose` CLI) — a live 0G call
> over the settled grammar, the §4 validator (I1–I12) wired as the reject → re-snapshot →
> re-infer loop with the labelled `TEMPLATE_FALLBACK`, and the user's own book feeding the prompt
> (F3 via `--maker`). The §5 Gate 2 reviewer remains a **stretch**.

**What F2 owns:** the recommendation codec, the request envelope and its invariants, sealed
inference, the validator, and the reviewer (stretch). **F2 does not own:** the strategy
grammar/compiler being filled in (F1), the market/book data (F3), or the request flow that runs
it (Wiring §4).

## Status

- **Entry gate (Gate 0 / G2) — PASSED.** The 0G inference spike ran live against a Galileo
  provider via `packages/arbitration-sdk` (PR #6). A **stable enclave signer** recovers across
  runs. Captured: chainId **16602**; live chat model **`qwen/qwen2.5-omni-7b`** (provider
  `0xa48f…7836`); TEE signer **`0x83df4B8E…508cF`**; `addLedger(3)` accepted; latency ~1–2.6s.
- **Load-bearing Gate 0 finding.** The signed bytes are **not** our text; they are a provider
  attestation record (`reqHash:respHash:centralized:aliyun:certHash`), and `respHash` is over a
  provider-internal representation we cannot reproduce. Provenance survives: recovering the
  signature to the stable TEE signer proves a real 0G enclave produced the response, and
  `recommendationId = keccak256(signedText)` is the payload id.
- **Since merged:** the composer + validator (I1–I12) + reject/re-infer loop + `TEMPLATE_FALLBACK`
  (#13, #20) and F3 book context via `--maker` (#17) are in. The reviewer remains a stretch.

## Decisions locked (from the pivot)

| # | Decision | Where |
| --- | --- | --- |
| Framing | Creation-time composer; **user signs and ships**; no daemon/tick loop. Flow: infer → validate → present → ship. | Notion §2, Wiring §4 |
| One tx | `Multicall[ship,…]` (**user's**) — the only transaction; the user signs and pays once. | Wiring §5 |
| Request envelope | Replaces the mandate; **built per request** from the user's own input (`prompt`, `budget`, `maxStrategies`, `maxDeadlineSec`, `maxInferenceRetries`). No stored `realBalance`. `allowPartial` gone (structural, per F1 §5). | Notion §5 |
| Validator | Deterministic `validate()` I1–I12; **rejects, never mutates**. Reject-and-re-infer (≤ `maxInferenceRetries`), then **TEMPLATE_FALLBACK** (labelled, never a model output). | Notion §4/§6 |
| Reasoning | Excluded from the signed payload. | Notion §3 |
| Chain | Base **fork** at a pinned block (`config/addresses.8453.json`). chainId 8453 == mainnet, so guard with a **fork probe** + `SLUICE_ALLOW_MAINNET`, never a chainId assert. | Wiring §9 |

## Cross-feature dependencies

- **F1 — grammar & compiler:** the validator (I5–I11) and the codec consume F1's slot grammar,
  `StrategyTemplate.compile()`, `worstCaseDraw()`, and `strategyHash`. The shipped `strategy` bytes
  **are `abi.encode(Order{maker, traits, program})`**, so `strategyHash = keccak256(abi.encode(order))`;
  the bare program is never hashed. Fork-verified — PR #14 / `StrategyHashSemantics.t.sol`. Two layers,
  both true: at the Aqua layer `keccak256(strategy)` has no maker in the preimage, so identical
  **bytes** collide across makers (F3 keys on `(maker, app, strategyHash)`, which is required); at the
  order layer the maker is embedded in the bytes, so identical **programs** from different makers do
  not. See F1 §2.
  *F1 Open Q1 (partial-fill) / Q2 (`_decayXD` slot) must settle on the fork first.*
- **F3 — context:** COMPOSE/VALIDATE consume `MarketContext` (`PairContext` + `userBook`) from
  `context.ts`; `liveBalance` via `eth_call` at `observedBlock`, never the index.
- **Wiring — flow/tx/config:** steps 3–5b, 9, 11 of the request flow are F2; `ZG_*`,
  `SLUICE_DRY_RUN` per Wiring §9. Repo layout: F2 code lives in
  `packages/arbitration-sdk/src/{inference,validate,review}.ts`.

## Sub-components

### 1. Recommendation codec (`packages/arbitration-sdk/src/recommendation.ts`)

`StrategyRecommendation` (`schema: "sluice.recommendation/1"`), `frame()`/`parse()`,
`validateSchema()` (ajv/zod, no fences). Amounts are **decimal strings**. Carry
the enclave's exact signed bytes end-to-end (no canonicalization).

### 2. Sealed composition inference (`packages/arbitration-sdk/src/inference.ts`)

Extends the Gate-0 CLI client. `compose(broker, ctx, request)` builds the §9 prompt (grammar +
schema + request + F3 context + templates + violation history), POSTs, reads `ZG-Res-Key`, fetches
the out-of-band signature, `verifyLocal()` (`verifyMessage` recovers a signer **and**
`processResponse`). Per-attempt latency logged. Reuses the CLI's ledger-funded broker,
`createRequire` CJS interop, and provider-metadata model.

### 3. Request envelope + validator (`packages/arbitration-sdk/src/validate.ts`)

`RecommendationRequest` type; `validate(r, q, s): Violation[]` I1–I12 (rejects, never mutates).
I5–I11 consume F1 grammar/compile; I12 freshness; I2 budget; I15 **parked**
(whole-balance only).

### 4. Reject-and-re-infer + template fallback (`packages/arbitration-sdk/src/compose.ts`)

Flow steps 2–5b: re-snapshot each attempt (only violation history carries forward), ≤
`maxInferenceRetries`, then `TEMPLATE_FALLBACK`. Then COMPILE → PRESENT.

### 5. Reviewer — Gate 2 (`packages/arbitration-sdk/src/review.ts`) · STRETCH

Second inference over an *already-valid* recommendation → risk rating + intent-match; **flags,
never vetoes**. Build only after 1–4 are green; first to drop.

## Build sequence (dependency order — Wiring §7 track A 5–9)

1. **Codec** — round-trip/golden tests. *Dep: F1 chain/grammar.* — **done**
2. **Sealed inference + validator** (Issues 4–5) — extend the CLI client; validator I1–I12 property
   tests. *Dep: F1 grammar/compile, F3 `MarketContext`.* — **done**
3. **Loop + fallback** (Issue 6) — flow 2–5b. *Dep: F3 context.* **Gate:** a prompt → validated
   recommendation that compiles + ships, with rejected attempts surfaced. — **done**
4. **Reviewer** (Issue 10) — stretch.

## Open questions — status

- **Q1. Custom attested image?** Plan NO (0G serves models, not arbitrary code) → reject-and-re-infer;
  never claim in-enclave validator on stage unless running. Ask 0G booth early. *(Notion §11)*
- **Q3. User-facing latency** — first datapoint from Gate 0 (~1–2.6s). Decides streamed-"composing…"
  vs plain spinner at flow step 3. *(Notion §11)*
