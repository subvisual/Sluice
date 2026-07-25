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
