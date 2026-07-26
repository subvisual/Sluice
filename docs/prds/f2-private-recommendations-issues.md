# F2 — Private Recommendations · Issues

Derived from [`f2-private-recommendations.md`](./f2-private-recommendations.md). Issues in
dependency order.

**Reconciled 2026-07-25** against the **strategy composer** shipped in PR #10, built directly
rather than through `issue-worker`. **Cut 2026-07-26:** the deferred on-chain/audit half of F2
(the old issues 2, 7, 8 and 9) was removed from the project entirely; those specs live in git
history. Issue numbers are kept stable, so the sequence below has gaps.

## Status legend

- ✅ **delivered**
- 🟡 **partially delivered** — core landed (usually via the composer, PR #10)
- 🚧 **blocked** — on an external prerequisite
- ⬜ **planned** — in scope, not started

## Dependency graph

```
0 Gate 0 (DONE) ──▶ 3 Codec 🟡 ──────────┐
  (CLI, PR #6)      4 Sealed compose 🟡 ─┼─▶ 6 Loop + fallback ✅ ─▶ 10 Reviewer ⬜ (stretch)
                    5 Validator ✅ ──────┘
```

The composer (PR #10) delivers the recommendation spine that cuts across **3, 4, and the retry
part of 6**. **Cross-feature:** 5 needs F1 (grammar `compile`); real market/book context is F3,
not an F2 issue.

---

## Already delivered — not work items

**Gate 0 — validate 0G inference (PR #6).** The inference CLI (`packages/arbitration-sdk`). A
stable enclave signer recovers across ≥3 runs; chainId 16602, model `qwen/qwen2.5-omni-7b`, TEE
signer `0x83df4B8E…508cF`, `addLedger(3)` accepted, latency ~1–2.6s. **Finding:** the signature is
over a provider attestation record, not our text. The surviving consequences: provenance is the
recovered TEE signer, and `recommendationId = keccak256(signedText)` is the payload id. (The
on-chain binding design this finding forced, resolved in PR #8, was removed with the on-chain
layer; git history has it.)

**The strategy composer (PR #10)** — prompt + budget → a grammar-shaped `StrategyRecommendation`
from a live 0G call. `grammar.ts` (six-slot menu + templates T1–T3), `context.ts` (stubbed F3
context), `compose.ts` (prompt + round-trip, one retry), `recommendation.ts` (types + light
structural parse), `compose` CLI. Output is grammar-**shaped**; compilation and shipping came
later (F1 / the app). This is what makes Issues 3/4 below *partially* delivered.

---

## 3. Recommendation codec (`arbitration-sdk/src/recommendation.ts`) · 🟡 partially delivered

**Delivered (PR #10):** the `StrategyRecommendation` / `SlotAssignment` types and a **light
structural parse** (`parseRecommendation`) — parseable, right shape, decimal-string amounts,
budget containment; unknown opcodes are soft notes (grammar is provisional). Six unit tests.

### Acceptance criteria
- [x] `StrategyRecommendation` type; parse of the model output; decimal-string amounts preserved;
  malformed body is a retry, never a throw.
- [ ] 🚧 golden fixture: signed text round-trips and `strategyHash`es match F1 `compile`.

---

## 4. Sealed composition inference (`arbitration-sdk/src/compose.ts`) · 🟡 partially delivered

**Delivered (PR #10):** `compose(broker, cfg, request, ctx)` builds the prompt (grammar +
rules + output schema + request + stubbed context + retry history), runs the 0G round-trip via
`inferChat`, parses the result, retries once on malformed output. Reuses the Gate 0 broker /
`createRequire` interop / provider-metadata model. The out-of-band enclave signature is fetched
and its signer recovered (`verifyMessage` + `processResponse`), surfaced to the caller as the
proof block.

**Not delivered:** context is the stub, not live F3.

### Acceptance criteria
- [x] `compose()` builds the prompt, POSTs, returns a parsed `StrategyRecommendation`.
- [x] the enclave signature is fetched and the signer recovered; surfaced with the result.
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
  `fee ∈ WRAPPER_OPTIONS` with `feeBps ∈ [1, 1e9)` — 0 excluded since #44: it compiles to a
  `FLAT_FEE_AMOUNT_IN_XD` that charges nothing, which is what the no-fee templates are for —
  `guards ∈ GUARD_OPTIONS`), I7 (deadline within
  `(now, now + maxDeadlineSec]`), I8 (known `templateId`), I10 (canonical ascending token order —
  catches the token0/token1 inversion), I11 (each virtualAmount a decimal string, strictly > 0).
- **Freshness:** I12 (`observedBlock` within N blocks of head; future snapshots also rejected).

28 property/example tests, incl. the `0.1+0.1+0.1 ≤ 0.3` exactness case, a "never mutates input"
check, and a coverage test asserting only in-scope codes ever fire.

**N/A on this venue** (the opcodes do not exist on the deployed router, so these are documented, not
emitted): **I6** (partial-fill ⇒ token-invalidation — no LimitSwap/invalidation opcode) and **I9**
(oracle-adjuster ⇒ feed — no oracle opcode). **Parked:** **I15** (whole-balance mode).

### Acceptance criteria
- [x] `validate(r, q, s): Violation[]` implements **I1–I5, I7, I8, I10–I12** (rejects, never
  mutates); property tests never return "valid" for a violating recommendation and never mutate.
- [x] I6, I9 are N/A on the deployed venue (no opcode) — documented, never emitted.
- [x] Wire the gate into the composer's reject-and-re-infer loop *(Issue 6)*.

---

## 6. Reject-and-re-infer loop + template fallback (`arbitration-sdk/src/compose.ts`) · ✅ delivered

The **validator-driven reject-and-re-infer** loop **and** the deterministic
**TEMPLATE_FALLBACK**. Each attempt is parsed for shape then run through `validate()` (Issue 5);
a malformed OR violating output is fed the rejection reason and re-inferred (bounded by
`MAX_COMPOSE_ATTEMPTS`). After the attempts are spent, `compose()` returns a labelled template
recommendation built by `fallback.ts`, never a model output. `ComposeResult.source` is
`ENCLAVE` | `TEMPLATE_FALLBACK` and `ComposeResult.violations` records the last model attempt's
verdict; the CLI surfaces both. The validator's `ChainState` is derived from the F3 context by
`chainStateFor()` (snapshot block = freshness reference, snapshot time bounds the deadline).

### Acceptance criteria
- [x] Malformed output triggers a bounded re-infer.
- [x] `TEMPLATE_FALLBACK` after retries (labelled, never a model output). `fallback.ts` +
  `selectTemplate` (deterministic intent heuristic); output is budget-bounded and within
  `maxDeadlineSec`; 8 unit tests.
- [x] Validator-driven reject-and-re-infer — `validate()` gates every well-formed attempt; a
  violation is fed back as the next attempt's rejection notes. 6 unit tests via an injected fake
  inference (`InferFn`), no broker/network.

---

## 10. Reviewer — Gate 2 (`arbitration-sdk/src/review.ts`) · ⬜ planned (stretch)

A second inference over an already-valid recommendation ("is this a good idea?"). A stretch:
build only after everything else is green; first to drop.

- [ ] `review()` produces a risk rating + intent-match verdict; flags, never vetoes.

---

## What's actually left

The recommendation path is working end-to-end: the composer runs the **validator** (Issue 5)
in a **reject-and-re-infer loop** (Issue 6) — a violating model output is fed the failing invariant
and re-inferred, then falls through to the deterministic `TEMPLATE_FALLBACK`. The validator itself
hard-rejects out-of-budget, wrong-chain, stale, mis-ordered-token, bad-deadline, unknown-template,
and off-menu-instruction recommendations (I1–I5, I7, I8, I10–I12; I6/I9 are N/A on the deployed
venue). What remains:

- **Real F3 context** — swap the job-2 market stub; F3 work, tracked there.
- **Reviewer (Issue 10)** — the risk-rating stretch.
