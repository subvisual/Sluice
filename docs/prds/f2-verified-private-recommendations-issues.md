> **⚠️ SUPERSEDED (2026-07-25) — see the pivot banner in
> [`f2-verified-private-recommendations.md`](./f2-verified-private-recommendations.md).**
> The F2 Notion page pivoted to a creation-time Strategy Composer (recommendations, per-user nonce,
> user-signed ship). These issues describe the old daemon framing and are kept for history only —
> **do not build from them.** Read the pivoted
> [F2 — Verified Private Recommendations](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b)
> and regenerate issues when F2 implementation resumes. (Gate 0's live finding — 0G signs an
> attestation record, not our text — further invalidates the tracer/registry issues below.)

# F2 — Verified Private Decisions · Issues

Derived from [`f2-verified-private-decisions.md`](./f2-verified-private-decisions.md). Issues in
dependency order; the tracer bullet (Issue 2) is the thinnest slice proving ADR-0001 end-to-end.
Issue 1 is a **prerequisite validation gate**, not production code — F2's architecture rests on
an external assumption (the enclave signs recoverable EIP-191 text), so it is proven *before* the
tracer, deliberately ahead of the usual "tracer first" rule.

## Dependency graph

```
1 Gate 0 (spike) ──▶ 2 Tracer: framed commit ──┬─▶ 3 Inference client ─┐
                                               └─▶ 4 Validator I1–I14b ┴─▶ 5 Loop + fallback ─┬─▶ 6 Narration ─┐
                                                                                              └─▶ 7 Memory ────┴─▶ 8 Dashboard decrypt
                                                                                    9 M4 exit gate ◀── 5 (+6,7) + F1 + F3
```

**Parallelisable:** 3 ∥ 4 · 6 ∥ 7.
**Cross-feature deps:** 4 & 5 need F1 strategy metadata + hour-1 finding; 8 overlaps the dashboard (Wiring §6 / M6); 9 needs F1's induced revert + F3's context.

---

## 1. Gate 0 — validate 0G inference (spike)

**Depends on:** none

### Description
Prove the assumption everything rests on, against a live Galileo provider, before any F2 code.
The spike file already exists; this issue is running it, adapting to the installed SDK, and
recording its outputs back into the PRD.

### Acceptance criteria
- [ ] `packages/arbitration-sdk/spike/inference-spike.ts` runs against a live provider and funds the compute ledger.
- [ ] `verifyMessage(text, sig)` recovers a **stable signer** across ≥3 calls; the address is recorded as the `registerSigner` target (handling `targetSeparated`/`targetTeeAddress`).
- [ ] Whether the signed `text` is **byte-identical** to the received content is determined and recorded.
- [ ] Deposit-min, faucet reality, Galileo chainId (16601 vs 16602), first latency, and attempt-1 framing-compliance rate are recorded into the PRD.

### Technical notes
Adapt `broker.ledger.depositFund` / `getServiceMetadata` / `getRequestHeaders` to whatever
`@0gfoundation/0g-compute-ts-sdk` actually exposes. If byte-identity DIFFERS, everything
downstream hashes/parses the **signed** text, never the response body.

---

## 2. Tracer bullet — a framed decision commits on-chain

**Depends on:** 1

### Description
Thinnest production slice proving ADR-0001: `DecisionRegistry` + the framing codec + local EIP-191
verify. Uses a **test signer key** as the enclave stand-in (real enclave sig proven in Issue 1)
and a fixed decision, so this issue is pure binding architecture — no live inference, validator,
retries, or memory yet.

### Acceptance criteria
- [ ] `DecisionRegistry.sol` — `registerSigner`/`registerCommitter`/`commitDecision(onlyCommitter)`/`_epochFromPrefix` — deployed to Ethereum Sepolia (11155111).
- [ ] `decision.ts` `frame()`/`parse()` build and consume the 3-line text; epoch lives in the prefix only; no JCS.
- [ ] **Golden fixture:** one checked-in signed-text string → Foundry `_epochFromPrefix(text) == 42` **and** TS `parse(text) == expectedStruct`.
- [ ] A test-key-signed framed text commits and emits `DecisionCommitted`; unregistered signer, unauthorized committer, stale/equal epoch, and **replay-with-relabelled-epoch** all revert.

### Technical notes
OpenZeppelin `ECDSA` + `MessageHashUtils.toEthSignedMessageHash(bytes)`; immutable
`EXPECTED_HEADER = "sluice.book-decision/1;chain=11155111"`; `decisionHash = keccak256(signedText)`.

---

## 3. Live sealed-inference client

**Depends on:** 2 · *(parallel with 4)*

### Description
`inference.ts` — the real 0G Compute client that produces an enclave-signed framed decision and
commits it through Issue 2's `commitDecision`.

### Acceptance criteria
- [ ] `initBroker` + `ensureLedgerFunded` (the M4 funding gate); `infer()` dictates header+epoch in the prompt, uses single-use `getRequestHeaders`, POSTs `/chat/completions`, reads `ZG-Res-Key`, and fetches the out-of-band signature.
- [ ] `verifyLocal()` asserts `verifyMessage(text, sig) === registered signer` **and** `broker.inference.processResponse === true`.
- [ ] A **real enclave-signed** framed decision commits on-chain via Issue 2's path.
- [ ] Per-attempt latency logged; a malformed response counts as a retry and never throws to the chain.

### Technical notes
Register `teeSignerAddress` (or `targetTeeAddress`) from Issue 1. One agent keypair funded on both
Galileo (compute) and Sepolia (commit gas).

---

## 4. Mandate validator I1–I14b

**Depends on:** 2 · *(parallel with 3)* · **F1:** `strategy.allOrNothing`/`worstCaseDraw` + hour-1 finding

### Description
`mandate.ts` — the deterministic gate that rejects (never mutates) a non-compliant decision.

### Acceptance criteria
- [ ] `Mandate` type includes `partialFillReverts` (default **true**) and `perToken.maxPerFill`.
- [ ] `validate(d, m, s)` implements I1–I14b and returns `Violation[]`; **I14a unconditional, I14b active only when `partialFillReverts`.**
- [ ] Property tests: never returns "compliant" for a violating decision; **never mutates its input**.
- [ ] Crafted-input tests: I7 (stale hash), I10 (token order), I12 (stale block) each fire.

### Technical notes
`partialFillReverts` is set from the F1 hour-1 fork finding; default true fails over-restrictive.
Consumes F1's `strategy.allOrNothing` / `worstCaseDraw()`.

---

## 5. Reject-and-re-infer loop + owner fallback

**Depends on:** 3, 4 · **F3:** `context.ts` by ~H17

### Description
Wire inference + validation into the tick (steps 5–8), with retries that re-snapshot and a
deterministic owner-fallback path.

### Acceptance criteria
- [ ] Tick steps 5–8 wired: `infer → verifyLocal → validate → commitDecision` (committer key signs the commit tx).
- [ ] A violation triggers **re-snapshot (steps 1–2) + re-infer**, carrying only violation history forward, up to `maxInferenceRetries`.
- [ ] After max retries → `ownerFallbackDock` via the owner path, tagged `OWNER_FALLBACK`, never presented as an agent decision.
- [ ] Every attempt (including rejected) is captured for the trace with per-attempt latency.

### Technical notes
Re-snapshot each attempt or I12 funnels slow inference into permanent fallback (F2 §4). Consumes
F3 `MarketContext`.

---

## 6. Post-commit narration

**Depends on:** 5 · *(parallel with 7)*

### Description
The separate, enclave-signed narration call that gives the trace its "here's why," bound to the
decision but off the critical path.

### Acceptance criteria
- [ ] `narrate()` makes a second call, enclave-signed over `decisionHash‖prose`, and runs **only after a commit succeeds**.
- [ ] Narration `{text, signature, signer}` verifies off-chain: recovers to a registered signer **and** its embedded `decisionHash` matches the on-chain commit.
- [ ] A slow or failed narration never blocks or delays a decision (fire-after-commit).

---

## 7. Encrypted memory (0G Storage)

**Depends on:** 5 · *(parallel with 6)*

### Description
`memory.ts` — the encrypted decision trace, learned weights, and rolling summary on 0G Storage.

### Acceptance criteria
- [ ] `deriveKey` from the **owner/maker wallet** (never the committer key); AES-256-GCM; `putTrace`/`getTrace` with a plaintext `index.json`; `download()` server-side only.
- [ ] `summary.json` (rolling ~50 epochs) and `weights.json` priors written on each PERSIST step.
- [ ] **Auditability test:** `keccak256(storedText) == on-chain decisionHash`; decrypt with a wrong key fails.

### Technical notes
Trace fields per PRD sub-component 5. Schema scaffolding can begin after Issue 2; content firms at Issue 5.

---

## 8. Dashboard trace decrypt + payloadHash check

**Depends on:** 7 · **overlaps** dashboard (Wiring §6 / M6)

### Description
The audit screen — the most persuasive judge-facing view — decrypting a trace server-side.

### Acceptance criteria
- [ ] A Next.js **server route** decrypts a trace by epoch (owner key stays server-side, never the browser).
- [ ] The panel shows reasoning, any rejected attempts + the invariant each violated, the signer, and `ENCLAVE` vs `OWNER_FALLBACK`.
- [ ] A green check confirms the recomputed `payloadHash` equals the on-chain commitment.

---

## 9. M4 exit gate — unattended induced-revert recovery

**Depends on:** 5 (+6, 7) · **F1:** induced revert · **F3:** context

### Description
The capstone integration proving the whole feature: the agent resolves the demo's over-commitment
scenario with no human in the loop, and the refusal is on the record.

### Acceptance criteria
- [ ] With the book over-committed and draining, the agent **unattended** docks S2 and resizes S3 within mandate.
- [ ] A **rejected attempt** appears in the encrypted trace.
- [ ] The next fill against the new `strategyHash` succeeds.

### Technical notes
Cross-feature capstone = the M4 exit gate. Pairs with F1's scripted revert (M2) and F3's live context.
