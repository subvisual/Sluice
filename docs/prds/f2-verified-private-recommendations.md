> **⚠️ SUPERSEDED (2026-07-25) — the F2 Notion page pivoted after this was written.**
> Sluice reframed from an autonomous daemon managing an over-committed book to a **creation-time
> Strategy Composer**: `DecisionRegistry`→`RecommendationRegistry`, global monotonic epoch→**per-user
> nonce**, mandate→request envelope + validator, tick loop→per-user request flow, and the **user**
> (not an agent) signs and ships. This document describes the old framing and is kept for history
> only — **do not build from it.** Read the pivoted
> [F2 — Verified Private Recommendations](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b)
> and rebuild this PRD when F2 implementation resumes.
>
> Additionally, the **Gate 0 live run** (2026-07-25) found that 0G signs a provider attestation
> record (`reqHash:respHash:centralized:aliyun:certHash`), **not** our framed text — invalidating
> the wire-format / registry-binding mechanism described below regardless of framing. See ADR-0001's
> Gate 0 update.

# F2 — Verified Private Decisions · Build Plan

Implementation plan for F2, produced from the grill session on 2026-07-25. **Notion is the
source of truth** for the concept and schemas ([F2 page](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b));
this file is the local, implementation-specific build-out (files, signatures, sequence, tests).

## Decisions locked (this session)

| # | Decision | Where |
| --- | --- | --- |
| Signing | Enclave signs the **response text**, **EIP-191** personal_sign, signature fetched out-of-band `GET {provider}/v1/proxy/signature/{chatID}?model=…` → `{text, signature}`. NOT EIP-712, NOT `(request,response)`. Confirmed against 0G docs. | ADR-0001 |
| On-chain binding | **Verify-over-text, not reproduce.** Contract verifies EIP-191 sig over `signedText` (bytes calldata) via OpenZeppelin `ECDSA`+`MessageHashUtils`; commits `keccak256(signedText)`. No Solidity serializer. | ADR-0001 |
| Wire format | 3-line framed text: `header\nepoch(20-digit)\nJSON-body`. Epoch in prefix only. **JCS dropped** — carry exact bytes end-to-end. | ADR-0001 |
| Reasoning | **Excluded from signed payload.** Separate narration call, signed over `decisionHash‖prose`, verified off-chain, runs **after** commit. | ADR-0001 |
| Commit auth | Enclave signer is **shared per-provider** → add `onlyCommitter` (separate agent key). Owner-only for `registerSigner`/`registerCommitter`/`ownerFallback`. | ADR-0002 |
| I14 | Split **I14a** (all-or-nothing, unconditional) / **I14b** (partial-fill, gated on `partialFillReverts`). New mandate fields `partialFillReverts` (default **true**) + `maxPerFill`. | Notion §5/§6 |
| Tick / I12 | Tick **45–60s**; I12 window ≈ 2× measured p95 latency; conservative placeholder N≈20 Sepolia blocks, recalibrate at H14. | Notion §7/§11 |
| Funding | `broker.ledger.depositFund` before inference; **"ledger funded ≥ verified min" is a hard M4 gate**. Verify deposit-min + faucet-cap in hour-1 spike; top up at 0G booth. | Notion §7/§10 |
| Storage key | Derived from **owner/maker wallet** sig, not the agent committer key. Decrypt server-side (Next.js route). | Notion §8 |

## Cross-feature dependencies

- **F1 — chain:** DecisionRegistry deploys to **Ethereum Sepolia (11155111)** (F1 closed Q2). 0G inference on **Galileo** (chainId 16601/16602 — confirm on wallet hour-1). `ecrecover` is chain-agnostic. One agent keypair funded on **both** (0G on Galileo for compute, ETH on Sepolia for commit gas).
- **F1 — strategy metadata:** validator I14a/I14b consume `strategy.allOrNothing` + `strategy.worstCaseDraw()` (F1 §5).
- **F1 — hour-1 Q1:** partial-fill cap-vs-revert sets `partialFillReverts` (default true until proven).
- **F1 — two-tx gate:** `SluiceApp` gates fills on the last **committed** epoch (Wiring §5). tx1 = `commitDecision`, tx2 = `AquaRouter` Multicall[dock, ship].
- **F1 — enums:** reuse `DockReason` codes; `BookDecisionCommit.ship/dock` map to AquaRouter params.
- **F3 — context:** `context.ts` (`MarketContext`: per-token derived metrics + per-strategy stats) ready by ~H17 (M3 H11–H17). Subgraph repoints after `Shipped`/`Docked`.

---

## Gate 0 — validate 0G inference FIRST (blocks all F2)

Before any contract or codec code, run the inference spike against a **live Galileo provider**:
`packages/arbitration-sdk/spike/inference-spike.ts`. It proves the one assumption everything
rests on and captures the numbers the design needs. **F2 development does not start until this
passes.**

Run:
```
cd packages/arbitration-sdk
npm i ethers @0gfoundation/0g-compute-ts-sdk tsx
SPIKE_PRIVATE_KEY=0x… npx tsx spike/inference-spike.ts
```

**Gate passes iff:**
- `verifyMessage(text, sig)` recovers a **stable signer** across calls → that address is exactly
  what `registerSigner` receives (handle `targetSeparated`/`targetTeeAddress`).
- you know whether the signed `text` is **byte-identical** to the received assistant content. If
  it DIFFERS (server normalization), hash/parse/store the **signed** text everywhere — never the
  received content. This directly decides what `keccak256(...)` covers on-chain.

**Also captured (data, not pass/fail — record back into this plan):** real `depositFund` min +
faucet reality, Galileo chainId (16601 vs 16602), first latency datapoint (seeds I12's window),
and the 7B's 3-line framing-compliance rate on attempt 1 (seeds `maxInferenceRetries`).

If EIP-191 recovery or byte-identity comes back different from what we drafted, the codec and
contract adjust here — cheaply — instead of after they're built.

---

## Sub-component 1 — `DecisionRegistry.sol` (`contracts/src/`)

```solidity
function registerSigner(address signer)     external onlyOwner;      // enclave key (provenance)
function registerCommitter(address agent)    external onlyOwner;      // our agent key (authz)
function commitDecision(bytes calldata signedText, bytes calldata sig, BookDecisionCommit calldata d)
    external onlyCommitter returns (bytes32 decisionHash);
function ownerFallbackDock(bytes32[] calldata hashes) external onlyOwner;
function _epochFromPrefix(bytes calldata signedText) internal pure returns (uint64); // header check + slice+atoi
```

- `commitDecision`: `ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(signedText), sig)` ∈ `isRegisteredSigner`; `epoch = _epochFromPrefix(signedText)`; require `epoch > lastEpoch`; `decisionHash = keccak256(signedText)`.
- Immutable `EXPECTED_HEADER = "sluice.book-decision/1;chain=11155111"` compared by `_epochFromPrefix`.
- Errors: `StaleEpoch`, `UnregisteredSigner`, `UnauthorizedCommitter`.

**Tests (Foundry):** signer recovers & commits (event) · unregistered signer reverts · unauthorized committer reverts · stale/equal epoch reverts · **replay with relabelled epoch reverts** (epoch read from prefix, not a submitter field) · **golden `_epochFromPrefix(checked-in text) == 42`**.

## Sub-component 2 — decision codec (`packages/arbitration-sdk/src/decision.ts`)

```typescript
const EXPECTED_HEADER = (chainId: number) => `sluice.book-decision/1;chain=${chainId}`;
function frame(epoch: bigint, chainId: number, body: BookDecisionBody): string;   // build 3-line text
function parse(signedText: string): { epoch: bigint; chainId: number; body: BookDecisionBody }; // throws on malformed / bad header
function validateSchema(body: unknown): asserts body is BookDecisionBody;          // ajv/zod, no fences
function toCommitStruct(p: ReturnType<typeof parse>): BookDecisionCommit;          // -> on-chain calldata
```

No canonicalization. Amounts are decimal strings (never JS number).

**Tests (TS):** `parse(golden text) == expectedStruct` · schema rejects fences/trailing commas · bigint amounts survive as decimal strings · malformed body counts as a retry (never throws to chain).

## Sub-component 3 — mandate + validator (`packages/arbitration-sdk/src/mandate.ts`)

```typescript
type Mandate = { /* …+ */ partialFillReverts: boolean; perToken: Record<Address, { /* … */ maxPerFill: bigint }> };
function validate(d: BookDecision, m: Mandate, s: BookState): Violation[];  // I1..I14b; REJECTS, never mutates
```

- I14a unconditional; I14b active only when `m.partialFillReverts`. Uses `strategy.allOrNothing` / `worstCaseDraw()`.

**Tests:** property-fuzz — never "compliant" for a violating decision, **never mutates input** · I14a/I14b under `partialFillReverts` true/false · I7 stale-hash, I10 token-order, I12 stale-block fire on crafted inputs.

## Sub-component 4 — sealed inference (`packages/arbitration-sdk/src/inference.ts`)

```typescript
function initBroker(wallet): Promise<ZGBroker>;                       // createZGComputeNetworkBroker
function ensureLedgerFunded(broker, min): Promise<void>;              // depositFund if below min — M4 gate
function infer(broker, ctx): Promise<InferResult>;                    // dictates header+epoch in prompt; getRequestHeaders (single-use); POST /chat/completions; read ZG-Res-Key; GET /v1/proxy/signature/{chatID}
function verifyLocal(signedText, signature, expectedSigner): boolean; // ethers.verifyMessage === signer; also broker.inference.processResponse
function narrate(broker, decisionHash, ctx): Promise<Narration>;      // 2nd call, signed over decisionHash‖prose, POST-COMMIT only
// InferResult = { signedText, signature, signer, chatID, latencyMs }
```

Register `teeSignerAddress` (or `additionalInfo.targetTeeAddress` if `targetSeparated`) via `registerSigner`.

**Tests:** **signature round-trip (= hour-1 spike)** — `verifyMessage(text, sig) === teeSignerAddress` and `text` byte-for-byte == assistant content · latency logged per attempt · malformed → retry → owner fallback.

## Sub-component 5 — encrypted memory (`packages/arbitration-sdk/src/memory.ts`)

```typescript
function deriveKey(ownerWallet): Promise<Uint8Array>;      // sign fixed message -> HKDF (owner/maker key, NOT committer)
function putTrace(epoch, trace): Promise<Root>;            // AES-256-GCM -> upload -> update plaintext index.json
function getTrace(epoch): Promise<Trace>;                  // server-side; download() Node-only
function putWeights(w) / getSummary(): …                   // rolling summary bounds prompt growth
```

Trace: `signedText`, decision sig, narration `{text,signature,signer}`, verdict, rejected attempts, per-attempt latency, txHash, `payloadHash == keccak256(signedText)`, promptVersion.

**Tests:** encrypt→upload→download→decrypt round-trip · wrong key fails · `index.json` enumerable plaintext · **trace auditability: `keccak256(storedText) == on-chain decisionHash`**.

---

## Build sequence — M4 (H14–H22), M5 (H22–H26)

- **H0–H1 · GATE 0 (blocks all F2):** run `spike/inference-spike.ts` (see Gate 0 above). Must pass — and its captured numbers recorded — before any F2 code.
- **H14 · re-confirm spike (~15m):** re-run the spike against the boot-current provider; confirm the recovered signer is unchanged and the ledger is funded ≥ verified min.
- **H14–H16 · DecisionRegistry:** contract + Foundry tests (signer/committer/epoch/replay/golden `_epochFromPrefix`). Deploy to Sepolia; register signer + committer. *Dep: F1 chain closed.*
- **H16–H18 · codec + inference client:** `decision.ts` framing + schema + TS round-trip/golden; `inference.ts` broker (ledger, infer, verifyLocal).
- **H18–H20 · validator:** `mandate.ts` I1–I14b + property tests. *Dep: F1 `strategy.allOrNothing`/`worstCaseDraw`; hour-1 finding → `partialFillReverts`.*
- **H20–H22 · loop:** reject-and-re-infer (re-snapshot each attempt) + owner fallback; integrate tick steps 5–8; narration post-commit. *Dep: F3 `context.ts` by ~H17.*
  - **Gate:** induced-revert scenario resolved unattended + a rejected attempt in the trace.
- **H22–H26 · M5 memory:** `memory.ts` 0G Storage encryption + server-side decrypt + `payloadHash` check + dashboard trace-panel decrypt.

## Open questions — status

- **Q1 custom attested image:** plan **NO** (0G serves models, not arbitrary code) → reject-and-re-infer. Ask 0G booth early; never claim in-enclave validator on stage unless running.
- **Q2 latency:** resolved (tick 45–60s, I12 recalibrated at H14).
- **Q3 partial-fill cap/revert:** F1 hour-1; default `partialFillReverts=true`.
- **Q4 canonical format:** resolved — framed text, JCS dropped.
- **Q5 chains:** resolved — Registry on Sepolia 11155111, inference on Galileo; one keypair on both.
- **Q6 two-tx gate:** resolved — SluiceApp gates on committed epoch.
