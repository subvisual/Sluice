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
