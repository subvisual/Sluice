# F2 — Verified Private Recommendations · Issues

Derived from [`f2-verified-private-recommendations.md`](./f2-verified-private-recommendations.md)
and the Notion [F2](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b) /
[Wiring](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe) pages. Issues in dependency
order. **Notion wins** on any disagreement.

**Reconciled 2026-07-25** against two things the original plan predates: (1) a **scope pivot** —
*get a recommendation working; defer verifiability* — and (2) the **strategy composer** shipped in
PR #10, built directly rather than through `issue-worker`. The verifiability half of F2
(on-chain commit, provenance, trace, reviewer) is **deferred, not deleted** — the specs below are
kept so the work is recoverable if that scope returns.

## Status legend

- ✅ **delivered**
- 🟡 **partially delivered** — core landed (usually via the composer, PR #10); the cut part is the verifiability/commit side
- ⛔ **deferred (out of current scope)** — verifiability; build only if the scope call reverses
- 🚧 **blocked** — on an external prerequisite
- ⬜ **planned** — in scope, not started

## Dependency graph

```
0 Gate 0 (DONE) ──▶ 1 Binding (RESOLVED) ──▶ 2 Registry ⛔ ──┬─▶ 3 Codec 🟡 ───────┐
  (CLI, PR #6)        (c)+(a); ADR-0001       (deferred)     └─▶ 4 Sealed compose 🟡┤
                                                                                    ├─▶ 6 Loop+fallback+commit 🟡 ─┬─▶ 7 Narration ⛔ ─┐
                                          5 Validator 🚧 (F1 Q2) ───────────────────┘                             └─▶ 8 Enc. memory ⛔ ┴─▶ 9 Trace view ⛔ ─▶ 10 Reviewer ⛔
```

The composer (PR #10) delivers the recommendation spine that cuts across **3, 4, and the retry
part of 6** — minus every verifiability step. **Cross-feature:** 5 needs F1 (grammar `compile`,
blocked on F1 Open Q2); real market/book context is F3, not an F2 issue.

---

## Already delivered — not work items

**Gate 0 — validate 0G inference (PR #6).** The inference CLI (`packages/arbitration-sdk`). A
stable enclave signer recovers across ≥3 runs; chainId 16602, model `qwen/qwen2.5-omni-7b`, TEE
signer `0x83df4B8E…508cF`, `addLedger(3)` accepted, latency ~1–2.6s. **Finding:** the signature is
over a provider attestation record, not our text — fed Issue 1.

**Issue 1 — Binding decision (design): RESOLVED 2026-07-25.** Chose **(c) provenance-oracle +
(a) trace-side hash**: `user`/`nonce` are committer-supplied args on `commitRecommendation`
(replay enforced in the contract, no `_prefixOf`); `recommendationId = keccak256(signedText)`; the
trace stores `payloadHash = keccak256(canonicalRecommendation)`. Security claim + pinned contract
shape in **ADR-0001**; PRD Decision A and Notion §2–§3 updated. Merged in PR #8. *(This decision
only bites once the deferred verifiability work resumes.)*

**The strategy composer (PR #10)** — prompt + budget → a grammar-shaped `StrategyRecommendation`
from a live 0G call. `grammar.ts` (six-slot menu + templates T1–T3), `context.ts` (stubbed F3
context), `compose.ts` (prompt + round-trip, one retry), `recommendation.ts` (types + light
structural parse), `compose` CLI. Output is grammar-**shaped**, not compiled/verified/persisted.
This is what makes Issues 3/4/6 below *partially* delivered.

---

## 2. `RecommendationRegistry.sol` (tracer) · ⛔ deferred

**Deferred** under the current scope (verifiability). Build only if on-chain provenance is
reinstated; the pinned shape below is ready when it is.

**Depends on:** 1 (resolved) · **F1:** chain on the Base fork

### Description
Deploy the registry to the Base fork, register signer + committer, commit a signed recommendation.

### Acceptance criteria
- [ ] `registerSigner`/`registerCommitter` (onlyOwner) + `commitRecommendation` (onlyCommitter),
  deployed to the **Base fork** (`config/addresses.8453.json`). Pinned signature (ADR-0001):
  `commitRecommendation(bytes signedText, bytes sig, address user, uint64 nonce, bytes32
  payloadHash, bytes32[] strategyHashes, bytes32[] templateIds)`.
- [ ] `ecrecover(signedText, sig) ∈ isRegisteredSigner`; **per-user `nonceOf` replay**
  (`nonce == nonceOf[user] + 1`); `recommendationId = keccak256(signedText)` (**distinct from**
  `payloadHash`); emits `RecommendationCommitted(user, nonce, recommendationId, signer,
  payloadHash, strategyHashes, templateIds)`.
- [ ] **`user`/`nonce` are committer-supplied args, NOT parsed from `signedText`** (no `_prefixOf`).
- [ ] Reverts: unregistered signer, unauthorized committer, **stale/replayed nonce**.
- [ ] **Not** wired into the ship path (binding is a subgraph derivation, Wiring §5).

### Technical notes
OZ `ECDSA` + `MessageHashUtils`. Committer = `SLUICE_COMMITTER_KEY`, separate from
`SLUICE_OWNER_KEY` (ADR-0002). Needs a `contracts/` Foundry workspace, which does not yet exist.

---

## 3. Recommendation codec (`arbitration-sdk/src/recommendation.ts`) · 🟡 partially delivered

**Delivered (PR #10):** the `StrategyRecommendation` / `SlotAssignment` types and a **light
structural parse** (`parseRecommendation`) — parseable, right shape, decimal-string amounts,
budget containment; unknown opcodes are soft notes (grammar is provisional). Six unit tests.

**Not delivered (deferred / blocked):** `frame()`/`toCommitArgs()` (commit-side, ⛔ verifiability)
and the golden-fixture `strategyHash` match (needs F1's `compile`, not built).

### Acceptance criteria
- [x] `StrategyRecommendation` type; parse of the model output; decimal-string amounts preserved;
  malformed body is a retry, never a throw.
- [ ] ⛔ `frame()`/`toCommitArgs()` → registry calldata *(deferred with the registry)*.
- [ ] 🚧 golden fixture: signed text round-trips and `strategyHash`es match F1 `compile`
  *(blocked on F1)*.

---

## 4. Sealed composition inference (`arbitration-sdk/src/compose.ts`) · 🟡 partially delivered

**Delivered (PR #10):** `compose(broker, cfg, request, ctx)` builds the §9 prompt (grammar +
rules + output schema + request + stubbed context + retry history), runs the 0G round-trip via
`inferChat`, parses the result, retries once on malformed output. Reuses the Gate 0 broker /
`createRequire` interop / provider-metadata model.

**Not delivered (deferred):** `verifyLocal()` — the enclave signature is received but **not
checked** (⛔ verifiability). Context is the stub, not live F3.

### Acceptance criteria
- [x] `compose()` builds the prompt, POSTs, returns a parsed `StrategyRecommendation`.
- [ ] ⛔ `verifyLocal()` asserts `verifyMessage === registered signer` **and** `processResponse`.
- [ ] real F3 `MarketContext` in place of the stub *(F3 work, not this issue)*.

---

## 5. Request envelope + validator I1–I14 (`arbitration-sdk/src/validate.ts`) · 🚧 blocked

The deterministic gate that **rejects** (never mutates) a non-compliant recommendation. A
`RecommendationRequest` type and a **light** budget/shape check already exist in the composer, but
the full I1–I14 validator is **blocked**: F1 §5 grammar is provisional and explicitly "the
validator must not be built against it" until **F1 Open Q2** settles against the forked bytecode.
Building it now would encode a grammar known to be wrong (e.g. `_xycConcentrateGrowLiquidityXD` is
not a real opcode; "exactly one swap-logic instruction" is not a protocol rule).

### Acceptance criteria
- [ ] 🚧 `validate(r, q, s): Violation[]` implements **I1–I14** (rejects, never mutates) *(unblock
  when F1 Q2 lands)*.
- [ ] Property tests: never returns "valid" for a violating recommendation; never mutates input.
- Note: budget/authority checks (I1–I4) do not depend on the grammar and are partly covered by the
  composer's light parse; the grammar-dependent invariants (I5–I11, I14) are what's blocked.

---

## 6. Reject-and-re-infer loop + template fallback + commit (`arbitration-sdk/src/compose.ts`) · 🟡 partially delivered

**Delivered:** the **one-retry** loop (PR #10) **and** the deterministic **TEMPLATE_FALLBACK** —
after retries exhaust, `compose()` returns a labelled template recommendation built by `fallback.ts`,
never a model output. `ComposeResult.source` is `ENCLAVE` | `TEMPLATE_FALLBACK`; the CLI surfaces it.

**Not delivered:** the validator-driven reject-and-re-infer (⬜, waits on Issue 5) and the
**commit (tx1)** + freshen steps (⛔ verifiability).

### Acceptance criteria
- [x] Malformed output triggers a bounded re-infer.
- [x] `TEMPLATE_FALLBACK` after retries (labelled, never a model output). `fallback.ts` +
  `selectTemplate` (deterministic intent heuristic); output is budget-bounded and within
  `maxDeadlineSec`; 8 unit tests.
- [ ] ⬜ Validator-driven reject-and-re-infer *(needs Issue 5)*.
- [ ] ⛔ FRESHEN + COMMIT (tx1, committer key) *(deferred with the registry)*.

---

## 7. Post-commit narration · ⛔ deferred

Verifiability-side: a second enclave-signed call over `recommendationId‖prose`, run after a
commit, verified off-chain. **Deferred with the commit path.** Spec retained.

- [ ] ⛔ `narrate()` — second call, enclave-signed, run only after a commit succeeds.
- [ ] ⛔ Verifies off-chain: recovers to a registered signer and its `recommendationId` matches the
  on-chain commit.

---

## 8. Encrypted memory — 0G Storage (`arbitration-sdk/src/memory.ts`) · ⛔ deferred

The encrypted recommendation trace on 0G Storage. **Deferred** (the trace exists to make
recommendations auditable/verifiable, which is the cut scope). Blocks on Open Q2 (key derivation)
if resumed. Spec retained.

- [ ] ⛔ `deriveKey` (per-user), AES-256-GCM, `putTrace`/`getTrace`, plaintext `index.json`.
- [ ] ⛔ `trace/{user}/{nonce}.json.enc` stores prompt, `signedText`, signature, verdict, rejected
  attempts, latencies, txHash, `payloadHash`, promptVersion.
- [ ] ⛔ Auditability test: `keccak256(storedText) == on-chain recommendationId`.

---

## 9. Trace decrypt view (app audit screen) · ⛔ deferred

The judge-facing audit screen that decrypts a trace and shows the `payloadHash` match. **Deferred
with the trace + registry** (nothing on-chain to check against under the current scope). Spec
retained.

- [ ] ⛔ Next.js server route decrypts a trace by `(user, nonce)`.
- [ ] ⛔ Shows rationale, rejected attempts + the invariant each violated, signer, `ENCLAVE` vs
  `TEMPLATE_FALLBACK`.
- [ ] ⛔ Green check: recomputed `payloadHash` == on-chain commitment.

---

## 10. Reviewer — Gate 2 (`arbitration-sdk/src/review.ts`) · ⛔ deferred

A second inference over an already-valid recommendation ("is this a good idea?"). Was a stretch
even under the original scope; **deferred**. Spec retained.

- [ ] ⛔ `review()` produces a risk rating + intent-match verdict; flags, never vetoes.
- [ ] ⛔ Verdict signed over `recommendationId‖verdict`, stored in the trace.

---

## What's actually left, under the current scope

The recommendation path is working (composer + the deterministic template fallback). The
**in-scope, buildable** F2 remainder is now essentially just:

- **The full validator** (Issue 5) — the moment **F1 Open Q2** settles the grammar, this unblocks
  and the composer's output can become grammar-*correct*.
- **Real F3 context** — swap the stub; F3 work, tracked there.

Everything under ⛔ waits on a decision to reinstate on-chain verifiability.
