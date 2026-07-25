# F2 — Verified Private Recommendations · Build Plan

Implementation plan for F2 under the **Strategy Composer** framing. **Notion is the source of
truth** for the concept and schemas ([F2 page](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b),
[Wiring](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe)); this file is the local,
implementation-specific build-out (files, signatures, sequence, tests). Regenerated 2026-07-25
after the pivot from the old daemon design; the previous version is in git history.

> **Build scope (2026-07-25) — recommendation-only; verifiability deferred.** The honest loop
> today is *prompt → validated recommendation*. **Deferred, not deleted** (mirrors the Notion F2
> banner): §2 `RecommendationRegistry` + the on-chain commit (tx1), §3's `payloadHash` binding,
> §4 Gate 2 reviewer, §8 encrypted trace, and signature verification. Everything below documents
> the full design; the deferred pieces are in scope but not in the current build.

**What F2 owns:** `RecommendationRegistry`, the recommendation codec, the request envelope and
its invariants, sealed inference, the reviewer (stretch), and encrypted memory. **F2 does not
own:** the strategy grammar/compiler being filled in (F1), the market/book data (F3), or the
request flow that runs it (Wiring §4).

## Status

- **Entry gate (Gate 0 / G2) — PASSED.** The 0G inference spike ran live against a Galileo
  provider via `packages/arbitration-sdk` (PR #6). A **stable enclave signer** recovers across
  runs. Captured: chainId **16602**; live chat model **`qwen/qwen2.5-omni-7b`** (provider
  `0xa48f…7836`); TEE signer **`0x83df4B8E…508cF`**; `addLedger(3)` accepted; latency ~1–2.6s.
- **Load-bearing Gate 0 finding — see "Decision A" below (RESOLVED).** The signed bytes are **not**
  our text; they are a provider attestation record. The binding redesign this forced is settled:
  (c) provenance-oracle + (a) trace-side hash. The registry is unblocked.

## Decision A — the on-chain binding · **RESOLVED (2026-07-25): (c) + trace-side (a)**

Gate 0 proved 0G's out-of-band `{ text, signature }` is EIP-191 over a fixed attestation record
`reqHash:respHash:centralized:aliyun:certHash` — **not** the response text, and `respHash` is over
a provider-internal representation we cannot reproduce. So the original Notion §2–§3 mechanism
(dictate a 3-line `header / user+nonce / JSON`, sign those exact bytes, read `user`+`nonce` from a
fixed-width prefix via `_prefixOf`, `recommendationId == our payload hash`) was **not
implementable** and is dropped.

**Chosen (Issue 1):** **(c) provenance-oracle** on-chain + **(a) trace-side hash** for
auditability. `(b)` rejected (depends on an unconfirmed request preimage; still not
on-chain-reproducible). Full reasoning, security claim, and pinned contract shape are in
**ADR-0001's Resolution section**; Notion §2–§3 updated to match. In one line:

- **On-chain (c):** `user`/`nonce` are **committer-supplied args** to `commitRecommendation`;
  replay enforced in the contract; the enclave signature proves only "a real 0G TEE produced
  *some* text". `recommendationId = keccak256(signedText)`.
- **Trace (a):** the trace stores `payloadHash = keccak256(canonicalRecommendation)`, recomputable
  by anyone holding the decrypted trace to bind our recommendation to the committed record.
  `recommendationId ≠ payloadHash` now — two distinct hashes.

**Still open (external, does not block build):** the 0G-booth check on whether a request/content
preimage is retrievable — informs (a)'s optional `reqHash` lean and the `targetTeeAddress`
question (§7). Tracked in ADR-0001.

## Decisions locked (from the pivot)

| # | Decision | Where |
| --- | --- | --- |
| Framing | Creation-time composer; **user signs and ships**; no daemon/tick loop. Flow: infer → validate → present → commit → ship. | Notion §2, Wiring §4 |
| Registry | `RecommendationRegistry` with **per-user nonce** replay (not a global epoch). `commitRecommendation` is `onlyCommitter`; emits `RecommendationCommitted(user, nonce, recommendationId, signer, payloadHash, strategyHashes, templateIds)`. | Notion §2 |
| Not in ship path | The registry is **not** gated into `ship()`. Binding is a **derivation** (subgraph joins Aqua ship events to the recommendation's declared `strategyHash`es), not an on-chain enforcement. | Wiring §5 |
| Two txs | tx1 = `commitRecommendation` (**ours**, committer key, our gas); tx2 = `Multicall[ship,…]` (**user's**). tx2 need not wait on tx1. | Wiring §5 |
| Request envelope | Replaces the mandate; **built per request** from the user's own input (`prompt`, `budget`, `maxStrategies`, `maxDeadlineSec`, `maxInferenceRetries`). No stored `realBalance`. `allowPartial` gone (structural, per F1 §5). | Notion §5 |
| Validator | Deterministic `validate()` I1–I14; **rejects, never mutates**. Reject-and-re-infer (≤ `maxInferenceRetries`), then **TEMPLATE_FALLBACK** (labelled, never a model output). | Notion §4/§6 |
| Reasoning | Excluded from the signed payload. Narration is a separate call signed over `recommendationId‖prose`, verified off-chain, run **after** commit. | Notion §3 |
| Commit auth | Enclave signer shared per-provider → `onlyCommitter` (`SLUICE_COMMITTER_KEY`), separate from `SLUICE_OWNER_KEY`. | ADR-0002 |
| Freshness | I12 re-checked at **commit time** (8b), not just at inference — a person takes minutes; the chain does not wait. | Notion §2, Wiring §4 |
| Chain | Base **fork** at a pinned block (`config/addresses.8453.json`). chainId 8453 == mainnet, so guard with a **fork probe** + `SLUICE_ALLOW_MAINNET`, never a chainId assert. | Wiring §9 |

## Cross-feature dependencies

- **F1 — grammar & compiler:** the validator (I5–I11, I14) and the codec consume F1's slot grammar,
  `StrategyTemplate.compile()`, `worstCaseDraw()`, and `strategyHash = keccak256(strategy)` (raw
  bytes, **no `abi.encode`**, `Aqua.sol:41` — see F1 §2; Notion Wiring §2 still shows the
  `abi.encode` form and needs correcting).
  The registry emits `strategyHash`es F1's ship path produces. *F1 Open Q1 (partial-fill) / Q2
  (`_decayXD` slot) must settle on the fork first.*
- **F3 — context:** COMPOSE/VALIDATE consume `MarketContext` (`PairContext` + `userBook`) from
  `context.ts`; `liveBalance` via `eth_call` at `observedBlock`, never the index.
- **Wiring — flow/tx/config:** steps 3–5b, 8b, 9, 11 of the request flow are F2; `SLUICE_COMMITTER_KEY`
  / `SLUICE_OWNER_KEY`, `ZG_*`, `SLUICE_DRY_RUN` per Wiring §9. Repo layout: F2 code lives in
  `packages/arbitration-sdk/src/{inference,validate,review,memory}.ts` + `contracts/src/RecommendationRegistry.sol`.

## Sub-components

### 1. `RecommendationRegistry.sol` (`contracts/src/`)

```solidity
function registerSigner(address signer)   external onlyOwner;   // enclave key (provenance)
function registerCommitter(address agent)  external onlyOwner;   // our agent key (authz)
function commitRecommendation(
    bytes signedText, bytes sig,          // 0G attestation record (opaque) + EIP-191 sig
    address user, uint64 nonce,           // committer-supplied (Decision A / (c))
    bytes32 payloadHash,                  // keccak256(canonicalRecommendation) — trace anchor (a)
    bytes32[] strategyHashes, bytes32[] templateIds
) external onlyCommitter returns (bytes32 recommendationId);
```
`ecrecover(toEthSignedMessageHash(signedText), sig) ∈ isRegisteredSigner`; per-user nonce replay
(`nonce == nonceOf[user] + 1`); `recommendationId = keccak256(signedText)` (distinct from
`payloadHash`); emit `RecommendationCommitted(user, nonce, recommendationId, signer, payloadHash,
strategyHashes, templateIds)`. **`user`/`nonce` are committer-supplied args, not parsed from the
signed bytes** (Decision A resolved — see ADR-0001). Deploy to the Base fork; register signer +
committer.

### 2. Recommendation codec (`packages/arbitration-sdk/src/recommendation.ts`)

`StrategyRecommendation` (`schema: "sluice.recommendation/1"`), `frame()`/`parse()`,
`validateSchema()` (ajv/zod, no fences), `toCommitArgs()`. Amounts are **decimal strings**. Carry
the enclave's exact signed bytes end-to-end (no canonicalization). Frame shape (whether we still
dictate fixed prefix lines) follows Issue 1.

### 3. Sealed composition inference (`packages/arbitration-sdk/src/inference.ts`)

Extends the Gate-0 CLI client. `compose(broker, ctx, request)` builds the §9 prompt (grammar +
schema + request + F3 context + templates + violation history), POSTs, reads `ZG-Res-Key`, fetches
the out-of-band signature, `verifyLocal()` (`verifyMessage === registered signer` **and**
`processResponse`). Per-attempt latency logged. Reuses the CLI's ledger-funded broker,
`createRequire` CJS interop, and provider-metadata model.

### 4. Request envelope + validator (`packages/arbitration-sdk/src/validate.ts`)

`RecommendationRequest` type; `validate(r, q, s): Violation[]` I1–I14 (rejects, never mutates).
I5–I11/I14 consume F1 grammar/compile; I12 freshness; I13 nonce; I2 budget; I15 **parked**
(whole-balance only).

### 5. Reject-and-re-infer + template fallback (`packages/arbitration-sdk/src/compose.ts`)

Flow steps 2–5b: re-snapshot each attempt (only violation history carries forward), ≤
`maxInferenceRetries`, then `TEMPLATE_FALLBACK`. Then COMPILE (I14) → PRESENT → 8b FRESHEN → COMMIT
(tx1). Narration fired after commit.

### 6. Post-commit narration

Second enclave-signed call over `recommendationId‖prose`; verified off-chain; stored in the trace;
never blocks the recommendation reaching the user.

### 7. Encrypted memory (`packages/arbitration-sdk/src/memory.ts`, 0G Storage)

`trace/{user}/{nonce}.json.enc` (prompt, `signedText`, signature, narration, verdict, rejected
attempts, latencies, txHash, `payloadHash`, promptVersion); `weights.json.enc` (per-template
priors, stretch); plaintext `index.json`. AES-256-GCM; **per-user key derivation (Open Q2)** —
default: each user signs to derive their own key; decrypt server-side (Next.js route).

### 8. Reviewer — Gate 2 (`packages/arbitration-sdk/src/review.ts`) · STRETCH

Second inference over an *already-valid* recommendation → risk rating + intent-match; **flags,
never vetoes**; verdict signed over `recommendationId‖verdict`, stored in the trace. Build only
after 1–7 are green; first to drop.

## Build sequence (dependency order — Wiring §7 track A 5–9, track B trace)

1. **Issue 1 — binding decision** (design; unblocks the registry). Update Notion §2–§3 + ADR-0001.
2. **Registry + codec** (Issues 2–3) — deploy to fork, register keys; codec round-trip/golden.
   *Dep: F1 chain/grammar.*
3. **Sealed inference + validator** (Issues 4–5) — extend the CLI client; validator I1–I14 property
   tests. *Dep: F1 grammar/compile, F3 `MarketContext`.*
4. **Loop + fallback + commit** (Issue 6) — flow 2–5b, 8b, tx1; narration (Issue 7). *Dep: F3
   context.* **Gate:** a prompt → validated, committed recommendation that compiles + ships, and a
   rejected attempt in the trace (Notion §10 exit gate).
5. **Encrypted memory + trace view** (Issues 8–9) — 0G Storage, per-user key, `payloadHash` check.
6. **Reviewer** (Issue 10) — stretch.

## Open questions — status

- **A. On-chain binding** — **RESOLVED** (Issue 1): (c) provenance-oracle + (a) trace-side hash.
  Registry unblocked. Residual external item: the 0G-booth preimage check (ADR-0001), non-blocking.
- **Q1. Custom attested image?** Plan NO (0G serves models, not arbitrary code) → reject-and-re-infer;
  never claim in-enclave validator on stage unless running. Ask 0G booth early. *(Notion §11)*
- **Q2. Per-user trace key derivation** — blocks memory (M5). Default: each user signs to derive
  their own key; decrypt server-side. Settle before the storage path is written. *(Notion §11)*
- **Q3. User-facing latency** — first datapoint from Gate 0 (~1–2.6s). Decides streamed-"composing…"
  vs plain spinner at flow step 3. *(Notion §11)*
