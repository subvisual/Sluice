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
                                          5 Validator ✅ (I1–I12 in scope; I13/I14 ⛔) ─┘                          └─▶ 8 Enc. memory ⛔ ┴─▶ 9 Trace view ⛔ ─▶ 10 Reviewer ⛔
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

## 5. Request envelope + validator (`arbitration-sdk/src/validate.ts`) · ✅ delivered

The deterministic gate that **rejects** (never mutates) a non-compliant recommendation.
`validate(r, q, s): Violation[]` in `src/validate.ts` is a pure, rejecting gate. It implements every
invariant that is in scope for the recommendation path **and** meaningful on the deployed
`AquaSwapVMRouter` (F1 grammar settled by PR #14 — `grammar.ts` is the router's complete menu):

- **Budget & authority:** I1 (token ∈ budget), I2 (per-token Σ virtualAmounts across **all**
  strategies ≤ budget — exact decimal-string maths, not floating point), I3
  (`strategies.length ∈ [1, maxStrategies]`), I4 (chain match).
- **Grammar (per strategy):** I5 (slots use only offered instructions — `curve ∈ CURVE_OPTIONS`,
  `fee ∈ WRAPPER_OPTIONS` with `feeBps ∈ [0, 1e9)`, `guards ∈ GUARD_OPTIONS`), I7 (deadline within
  `(now, now + maxDeadlineSec]`), I8 (known `templateId`), I10 (canonical ascending token order —
  catches the token0/token1 inversion), I11 (each virtualAmount a decimal string, strictly > 0).
- **Freshness:** I12 (`observedBlock` within N blocks of head; future snapshots also rejected).

28 property/example tests, incl. the `0.1+0.1+0.1 ≤ 0.3` exactness case, a "never mutates input"
check, and a coverage test asserting only in-scope codes ever fire.

**N/A on this venue** (the opcodes do not exist on the deployed router, so these are documented, not
emitted): **I6** (partial-fill ⇒ token-invalidation — no LimitSwap/invalidation opcode) and **I9**
(oracle-adjuster ⇒ feed — no oracle opcode). **Deferred:** **I4's `r.user == q.user` half** and
**I13 (nonce)** ride with the commit path (committer-supplied); **I14** (byte-for-byte
recompile-equality) is a ship-path defence — I5 already guarantees every named instruction is
dispatchable/compilable here; **I15** is parked (whole-balance mode).

### Acceptance criteria
- [x] `validate(r, q, s): Violation[]` implements **I1–I5, I7, I8, I10–I12** (rejects, never
  mutates); property tests never return "valid" for a violating recommendation and never mutate.
- [x] I6, I9 are N/A on the deployed venue (no opcode) — documented, never emitted.
- [ ] ⛔ I4 user-equality, I13 nonce, I14 recompile-equality *(deferred with the commit/ship path)*.
- [x] Wire the gate into the composer's reject-and-re-infer loop *(Issue 6)*.

---

## 6. Reject-and-re-infer loop + template fallback + commit (`arbitration-sdk/src/compose.ts`) · 🟡 partially delivered

**Delivered:** the **validator-driven reject-and-re-infer** loop **and** the deterministic
**TEMPLATE_FALLBACK**. Each attempt is parsed for shape then run through `validate()` (Issue 5);
a malformed OR violating output is fed the rejection reason and re-inferred (bounded by
`MAX_COMPOSE_ATTEMPTS`). After the attempts are spent, `compose()` returns a labelled template
recommendation built by `fallback.ts`, never a model output. `ComposeResult.source` is
`ENCLAVE` | `TEMPLATE_FALLBACK` and `ComposeResult.violations` records the last model attempt's
verdict; the CLI surfaces both. The validator's `ChainState` is derived from the F3 context by
`chainStateFor()` (snapshot block = freshness reference, snapshot time bounds the deadline).

**Not delivered:** the **commit (tx1)** + freshen steps (⛔ verifiability).

### Acceptance criteria
- [x] Malformed output triggers a bounded re-infer.
- [x] `TEMPLATE_FALLBACK` after retries (labelled, never a model output). `fallback.ts` +
  `selectTemplate` (deterministic intent heuristic); output is budget-bounded and within
  `maxDeadlineSec`; 8 unit tests.
- [x] Validator-driven reject-and-re-infer — `validate()` gates every well-formed attempt; a
  violation is fed back as the next attempt's rejection notes. 6 unit tests via an injected fake
  inference (`InferFn`), no broker/network.
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

The recommendation path is working end-to-end: the composer now runs the **validator** (Issue 5)
in a **reject-and-re-infer loop** (Issue 6) — a violating model output is fed the failing invariant
and re-inferred, then falls through to the deterministic `TEMPLATE_FALLBACK`. The validator itself
hard-rejects out-of-budget, wrong-chain, stale, mis-ordered-token, bad-deadline, unknown-template,
and off-menu-instruction recommendations (I1–I5, I7, I8, I10–I12; I6/I9 are N/A on the deployed
venue). The only **in-scope, buildable** F2 remainder is:

- **Real F3 context** — swap the job-2 market stub; F3 work, tracked there.

Everything under ⛔ (verifiability: registry, commit, trace, I13/I14) waits on a decision to reinstate
on-chain verifiability.
