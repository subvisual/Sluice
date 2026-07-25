# F2 — Verified Private Recommendations · Issues

Derived from [`f2-verified-private-recommendations.md`](./f2-verified-private-recommendations.md)
and the Notion [F2](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b) /
[Wiring](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe) pages. Issues in dependency
order. **Notion wins** on any disagreement. Regenerated 2026-07-25 for the Composer framing.

## Dependency graph

```
0 Gate 0 (DONE) ──▶ 1 Binding (RESOLVED) ──▶ 2 Registry ──┬─▶ 3 Codec ─────────┐
  (CLI, PR #6)        (c)+(a); ADR-0001       (Base fork)  └─▶ 4 Sealed compose ┤
                                                                                ├─▶ 6 Loop + fallback + commit ─┬─▶ 7 Narration ─┐
                                            5 Validator I1–I14 ◀─ F1, F3 ───────┘                               └─▶ 8 Enc. memory ┴─▶ 9 Trace view ─▶ 10 Reviewer (stretch)
```

**Parallelisable:** 3 ∥ 4 · 7 ∥ 8. **Cross-feature:** 2/3/5/6 need F1 (grammar, `compile`,
`strategyHash`); 5/6 need F3 `MarketContext`; 9 overlaps the app.

---

## Already delivered — not a work item

**Gate 0 — validate 0G inference:** shipped as the inference CLI (`packages/arbitration-sdk`,
PR #6). A stable enclave signer recovers across ≥3 runs; captured chainId 16602, model
`qwen/qwen2.5-omni-7b`, TEE signer `0x83df4B8E…508cF`, `addLedger(3)` accepted, latency ~1–2.6s.
**Finding:** the signature is over a provider attestation record, not our text — fed Issue 1.
Recorded in ADR-0001 + the package README + Notion.

**Issue 1 — Binding decision (design): RESOLVED 2026-07-25.** Chose **(c) provenance-oracle +
(a) trace-side hash**: `user`/`nonce` are committer-supplied args on `commitRecommendation`
(replay enforced in the contract, no `_prefixOf`); `recommendationId = keccak256(signedText)`;
the trace stores `payloadHash = keccak256(canonicalRecommendation)` as the off-chain audit anchor.
Security claim + pinned contract shape in **ADR-0001's Resolution section**; PRD Decision A and
Notion §2–§3 updated to match. **Residual (external, non-blocking):** the 0G-booth preimage /
`targetTeeAddress` check. **`issue-worker` now starts at Issue 2.**

---

## 2. `RecommendationRegistry.sol` (tracer)

**Depends on:** 1 (resolved — ADR-0001) · **F1:** chain on the Base fork

### Description
Thinnest slice proving the verified-recommendation path: deploy the registry to the Base fork,
register signer + committer, commit a signed recommendation.

### Acceptance criteria
- [ ] `registerSigner`/`registerCommitter` (onlyOwner) + `commitRecommendation` (onlyCommitter),
  deployed to the **Base fork** (`config/addresses.8453.json`). Pinned signature (Decision A /
  ADR-0001): `commitRecommendation(bytes signedText, bytes sig, address user, uint64 nonce,
  bytes32 payloadHash, bytes32[] strategyHashes, bytes32[] templateIds)`.
- [ ] `ecrecover(signedText, sig) ∈ isRegisteredSigner`; **per-user `nonceOf` replay**
  (`nonce == nonceOf[user] + 1`, then `nonceOf[user] = nonce`); `recommendationId =
  keccak256(signedText)` (**distinct from** the committer-supplied `payloadHash`); emits
  `RecommendationCommitted(user, nonce, recommendationId, signer, payloadHash, strategyHashes, templateIds)`.
- [ ] **`user`/`nonce` are committer-supplied args, NOT parsed from `signedText`** (Decision A
  chose (c) provenance-oracle — the signed record is opaque; there is no `_prefixOf`).
- [ ] Reverts: unregistered signer, unauthorized committer, **stale/replayed nonce**.
- [ ] **Not** wired into the ship path (binding is a subgraph derivation, Wiring §5).

### Technical notes
OZ `ECDSA` + `MessageHashUtils`. Register `teeSignerAddress` (or `targetTeeAddress` if
`targetSeparated` — Gate 0 saw a centralized broker) from the on-chain Service record. Committer =
`SLUICE_COMMITTER_KEY`, separate from `SLUICE_OWNER_KEY` (ADR-0002).

---

## 3. Recommendation codec (`composer-sdk/src/recommendation.ts`)

**Depends on:** 1 · *(parallel with 4)*

### Description
Build/consume the `StrategyRecommendation` payload and its commit args.

### Acceptance criteria
- [ ] `StrategyRecommendation` type (`schema: "sluice.recommendation/1"`, one-or-more `strategies`,
  each `{templateId, slots, tokens, virtualAmounts, deadline}`); `frame()`/`parse()`;
  `validateSchema()` (rejects fences/trailing commas); `toCommitArgs()` → registry calldata.
- [ ] **Golden fixture:** a checked-in signed-text string round-trips `parse` → expected struct, and
  `strategyHash`es match F1's `compile` output.
- [ ] `virtualAmounts` survive as **decimal strings** (never JS number); a malformed body counts as a
  retry, never throws to the chain.

### Technical notes
Carry the enclave's exact `signedText` bytes end-to-end (no canonicalization of the signed text).
**Separately** compute a canonical recommendation string and hash it into `payloadHash =
keccak256(canonicalRecommendation)` — the trace-side (a) anchor, distinct from `recommendationId`.
No fixed prefix lines: user/nonce are committer args, not in the body (Decision A / ADR-0001).

---

## 4. Sealed composition inference (`composer-sdk/src/inference.ts`)

**Depends on:** 2 · *(parallel with 3)* · **extends the Gate-0 CLI client**

### Description
Turn the Gate-0 round-trip into a composition call that returns a `StrategyRecommendation`.

### Acceptance criteria
- [ ] `compose(broker, ctx, request)` builds the §9 prompt (grammar + rules + output schema +
  request verbatim + F3 context + templates + violation history), POSTs `/chat/completions`, reads
  `ZG-Res-Key`, fetches the out-of-band signature.
- [ ] `verifyLocal()` asserts `verifyMessage(text, sig) === registered signer` **and**
  `processResponse === true`; per-attempt latency logged.
- [ ] Reuses the CLI's funded broker, `createRequire` CJS interop, and `getServiceMetadata` model;
  malformed output counts as a retry, never throws to the chain.

### Technical notes
Prompt contract Notion §9: mandate/grammar verbatim, `rationale` excluded (separate narration), no
tool use / no CoT in output, `promptVersion` into every trace.

---

## 5. Request envelope + validator I1–I14 (`composer-sdk/src/validate.ts`)

**Depends on:** 2 · **F1:** grammar + `compile`/`strategyHash` · **F3:** `MarketContext`

### Description
The deterministic gate that **rejects** (never mutates) a non-compliant recommendation.

### Acceptance criteria
- [ ] `RecommendationRequest` type (`prompt`, `budget`, `maxStrategies`, `maxDeadlineSec`,
  `maxInferenceRetries`); no stored `realBalance`.
- [ ] `validate(r, q, s): Violation[]` implements **I1–I14** (budget/authority I1–I4; grammar
  I5–I11; freshness/replay I12–I13; recompile-equality I14). **I15 parked** (whole-balance only).
- [ ] Property tests: never returns "valid" for a violating recommendation; **never mutates input**.
  Crafted-input tests fire I2 (budget over-sum), I6 (partial-fill missing invalidation), I10 (token
  order), I12 (stale block).

### Technical notes
Consumes F1 grammar/compatibility table and `compile` (I14 recompile-equality). `q.budget` is the
user's ceiling — never conflate with a live balance.

---

## 6. Reject-and-re-infer loop + template fallback + commit (`composer-sdk/src/compose.ts`)

**Depends on:** 4, 5 · **F3:** `context.ts`

### Description
Wire the request-flow spine (Wiring §4 steps 2–5b, 6, 8b, 9) with retries and the deterministic
template fallback, and the commit tx.

### Acceptance criteria
- [ ] Steps wired: SNAPSHOT → COMPOSE → VERIFY → VALIDATE → (COMPILE + I14) → PRESENT → **8b FRESHEN
  (re-check I12)** → COMMIT (tx1, committer key).
- [ ] A violation triggers **re-snapshot + re-infer** (only violation history forward) up to
  `maxInferenceRetries`, then `TEMPLATE_FALLBACK` (labelled, never a model output).
- [ ] Every attempt (incl. rejected) captured for the trace with per-attempt latency; commit does
  **not** block the user's ship (tx2).

### Technical notes
Re-snapshot each attempt or I12 funnels slow inference into permanent fallback (Notion §4). Consumes
F3 `MarketContext`; `SLUICE_DRY_RUN` composes+validates but commits/ships nothing.

---

## 7. Post-commit narration

**Depends on:** 6 · *(parallel with 8)*

### Description
The separate enclave-signed "here's why", bound to the recommendation but off the critical path.

### Acceptance criteria
- [ ] `narrate()` — a second call, enclave-signed over `recommendationId‖prose`, run **only after a
  commit succeeds**.
- [ ] Verifies off-chain: recovers to a registered signer **and** its embedded `recommendationId`
  matches the on-chain commit.
- [ ] A slow/failed narration never blocks or delays a recommendation (fire-after-commit).

---

## 8. Encrypted memory — 0G Storage (`composer-sdk/src/memory.ts`)

**Depends on:** 6 · *(parallel with 7)* · **blocks on Open Q2 (key derivation)**

### Description
The encrypted recommendation trace + rolling priors on 0G Storage.

### Acceptance criteria
- [ ] `deriveKey` (**per-user** — each user signs to derive their own key, Open Q2; never a shared
  maker key); AES-256-GCM; `putTrace`/`getTrace` with plaintext `index.json`; `download()`
  server-side only.
- [ ] `trace/{user}/{nonce}.json.enc` stores prompt, `signedText`, signature, narration, verdict,
  **rejected attempts**, latencies, txHash, `payloadHash`, promptVersion.
- [ ] **Auditability test:** `keccak256(storedText) == on-chain recommendationId`; decrypt with a
  wrong key fails.

### Technical notes
Encryption exists because 0G Storage is public-by-hash. `weights.json` (per-template ship/decline
priors) is a stretch — build only with spare time; do not claim it learns.

---

## 9. Trace decrypt view (app audit screen)

**Depends on:** 8 · **overlaps** the app (Wiring §6)

### Description
The most persuasive judge-facing screen — decrypting a trace server-side.

### Acceptance criteria
- [ ] A Next.js **server route** decrypts a trace by `(user, nonce)` (user key stays server-side,
  never the browser).
- [ ] Shows rationale, any rejected attempts + the invariant each violated, the signer, and
  `ENCLAVE` vs `TEMPLATE_FALLBACK`.
- [ ] A green check confirms the recomputed `payloadHash` equals the on-chain commitment.

---

## 10. Reviewer — Gate 2 (`composer-sdk/src/review.ts`) · STRETCH

**Depends on:** 6 (and ideally 8) · **first thing to drop**

### Description
A second inference over an *already-valid* recommendation that answers "is this a good idea?"

### Acceptance criteria
- [ ] `review()` produces a risk rating + intent-match verdict; **flags, never vetoes**.
- [ ] Verdict signed over `recommendationId‖verdict`, stored in the trace, so "warned and the user
  proceeded anyway" is on the record.
- [ ] Built **only** once Issues 1–8 are green.
