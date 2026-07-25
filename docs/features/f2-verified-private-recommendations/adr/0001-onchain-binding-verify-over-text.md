# On-chain decision binding: verify-over-text, not reproduce-in-Solidity

**Status:** accepted · 2026-07-25

`DecisionRegistry.commitDecision` binds a decision to its enclave signature by verifying
the **EIP-191 signature over the enclave's signed response text passed as `bytes calldata`**
(OpenZeppelin `MessageHashUtils.toEthSignedMessageHash` + `ECDSA.recover`) and committing
`keccak256(signedText)`. It does **not** re-serialize the decision struct on-chain.

## Why

The earlier plan ("reproduce, not parse") had Solidity re-serialize the struct to the exact
canonical string and `ecrecover` over it — the strongest binding, but it requires a bespoke
Solidity serializer matching a TS canonicalizer byte-for-byte, with "every decision reverts"
as the failure mode. For a 36h hackathon that is the single most custom, highest-risk piece
of code in F2, and nothing about it is reusable.

0G's own verification (confirmed from the docs) is already EIP-191 `personal_sign` over the
**response text**, fetched out-of-band (`GET {provider}/v1/proxy/signature/{chatID}?model=…`).
Since the signed artifact is opaque text either way, we verify it as opaque bytes on-chain and
reuse OpenZeppelin for the crypto — ~5 lines, zero bespoke serialization.

## Consequences

- **The prize claim survives:** every decision is still verified on-chain as coming from the
  registered enclave key. That is the load-bearing sentence, and it costs almost nothing.
- **Weaker where it doesn't matter:** the executed *struct* is bound to the signed text by the
  **off-chain compliance guard** (parse → validate → the struct executed is the struct
  verified), not by on-chain re-derivation. "Auditable, not trustless" for the struct; fully
  trustless for the signature. Provable to anyone holding the trace: `keccak256(storedText)`
  must equal the on-chain commit.
- **Wire format stays JCS-JSON** (reuse the `canonicalize` npm package) but is treated as
  opaque bytes on-chain — there is **no** `Solidity _serialize == TS canonicalize` golden
  fixture to build. The canonicalization sub-component collapses to "carry the enclave's exact
  signed bytes end-to-end and hash them."
- **Replay protection** requires the monotonic epoch to be bound to the signed bytes, not to a
  submitter-supplied field. The signed text carries the epoch as a **fixed-width prefix** so
  Solidity extracts it with a cheap slice + atoi (see follow-on decision on the exact wire
  shape). `payloadHash == keccak256(signedText) == decisionHash`.

---

## Update — Gate 0 live finding (2026-07-25): the "sign our exact bytes" premise does not hold

Live validation against a Galileo provider (`0xa48f…7836`, model `qwen/qwen2.5-omni-7b`, TEE
signer `0x83df4B8E…508cF`, chainId 16602) via the `packages/arbitration-sdk` inference CLI shows
the enclave does **not** sign the response text — nor any bytes we control. The out-of-band
`{ text, signature }` is EIP-191 `personal_sign` over a fixed 5-field **attestation record**:

```
reqHash(64hex) : respHash(64hex) : centralized : aliyun : certHash(64hex)
```

The model output appears only as `respHash`, and that hash is over a provider-internal
representation — `sha256`/`keccak256` of the response text do not reproduce it. So the core
premise of this ADR ("carry the enclave's exact signed bytes end-to-end; slice the epoch from a
fixed-width prefix; `keccak256(signedText)` is our decision hash") is **not implementable against
this provider** — we control neither the signed bytes nor their format.

**What survives:** the signature still recovers to the registered signer, so on-chain
`ecrecover ∈ isRegisteredSigner` proves TEE provenance — the load-bearing claim is intact.
`keccak256(signedText)` is still a valid per-response anchor.

**What must be redesigned before the registry is built:** binding *our* epoch/nonce + payload to
the on-chain commit when the signed bytes are opaque and non-reproducible (candidate directions
recorded in the Notion F2 page's "⚠️ Gate 0 update" block).

**Note on drift:** the Notion F2 page (source of truth) has since **pivoted** from this daemon /
`DecisionRegistry` / monotonic-epoch framing to a creation-time Strategy Composer /
`RecommendationRegistry` / per-user-nonce framing. This local ADR retains the older vocabulary;
the Gate 0 finding above applies identically to both, and the authoritative Gate 0 note lives on
the Notion page. The local F2 docs need reconciling with the pivot — tracked separately.

---

## Resolution — binding chosen (2026-07-25): **(c) provenance-oracle + (a) trace-side hash**

**Status:** accepted · supersedes the "verify-over-text with a fixed-width epoch/nonce prefix"
mechanism above. Decided in F2 Issue 1 (the binding redesign that the Gate 0 finding forced).

Of the three candidates in the Gate 0 block, we take **(c)** as the on-chain mechanism and layer
**(a)** as an off-chain auditability anchor. **(b)** is rejected: it depends on 0G exposing a
request preimage we could not confirm, and even if it did the binding would still not be
on-chain-reproducible — no advantage over (c) at more risk.

### The security claim, stated precisely

`commitRecommendation` guarantees exactly three things on-chain, and explicitly **not** a fourth:

1. **TEE provenance (trustless).** `ECDSA.recover(toEthSignedMessageHash(signedText), sig) ∈
   isRegisteredSigner` proves `signedText` was signed by a registered 0G enclave signer. It does
   **not** prove `signedText` contains *our* recommendation — the signed attestation record is
   opaque and `respHash` is non-reproducible from content.
2. **Committer authorisation (trust our key).** `onlyCommitter` proves the holder of
   `SLUICE_COMMITTER_KEY` chose to commit this record and vouches for the
   `(user, nonce, payloadHash, strategyHashes, templateIds)` association. **These are
   committer-supplied arguments, not parsed from the signed bytes.**
3. **Per-user replay protection (contract-enforced).** `nonceOf[user]` monotonic check rejects a
   stale or replayed `nonce`. Keyed on the committer-supplied `user`+`nonce`, **not** bound into
   the enclave signature.

**Not guaranteed on-chain:** that the committed `recommendationId` corresponds to our canonical
recommendation. That link is **auditable off-chain** (this is the (a) layer): the trace stores
`payloadHash = keccak256(canonicalRecommendation)`, and anyone holding the decrypted trace can
recompute it, check it equals the committed `payloadHash`, and check the stored `signedText`
recovers to a registered signer and hashes to `recommendationId`. *Auditable, not
signature-bound,* for the payload↔signature link.

One-line trust model: **provenance is trustless on-chain; the binding of that provenance to our
specific recommendation and to this user's nonce rests on the committer's honesty plus the public
trace, not on cryptography.** This is the honest claim the concept page already makes — the
operator "cannot fabricate an enclave-signed recommendation it did not produce, nor replay an old
one" survives verbatim; what changes is only *how* user/nonce reach the contract.

### The pinned `commitRecommendation` shape

```solidity
function commitRecommendation(
    bytes calldata signedText,          // 0G enclave attestation record — opaque
    bytes calldata sig,                 // EIP-191; must recover to a registered signer
    address user,                       // committer-supplied
    uint64  nonce,                      // committer-supplied; monotonic per user
    bytes32 payloadHash,                // keccak256(canonicalRecommendation) — trace anchor (a)
    bytes32[] calldata strategyHashes,
    bytes32[] calldata templateIds
) external onlyCommitter returns (bytes32 recommendationId);
```

- `recommendationId = keccak256(signedText)` — the per-response anchor (still valid).
- Checks: recovered signer ∈ `isRegisteredSigner`; `nonce == nonceOf[user] + 1`; then
  `nonceOf[user] = nonce`.
- Reverts: `UnregisteredSigner`, `UnauthorizedCommitter`, `StaleNonce`.
- Emits `RecommendationCommitted(user, nonce, recommendationId, signer, payloadHash,
  strategyHashes, templateIds)` — `payloadHash` added versus the pre-Gate-0 event.

### What this changes downstream

- **No `_prefixOf`, no fixed-width header/user+nonce lines.** The signed text is 0G's opaque
  `hash:hash:centralized:aliyun:hash` record; the model returns only the schema-valid JSON body.
- **`recommendationId ≠ payloadHash` now.** They were equal under the old "sign our exact bytes"
  premise; they are two distinct hashes here (`keccak256(signedText)` vs
  `keccak256(canonicalRecommendation)`), both stored in the trace.
- **The codec (Issue 3)** carries the enclave's exact `signedText` *and* computes a canonical
  recommendation string to hash into `payloadHash`; framing no longer dictates prefix lines.

### Still open (not closeable from this repo)

**0G-booth sanity-check** — confirm whether a request-hash or content-hash *preimage* is
retrievable from the provider. It does not change this decision (we chose (c), which needs no
preimage), but a "yes" would let (a)'s audit anchor also lean on `reqHash`, and it settles whether
the provider is a true model-weight TEE or a `centralized:aliyun` broker signer (§7 /
`targetTeeAddress`). Ask at the 0G booth; record the answer back here and on Notion.
