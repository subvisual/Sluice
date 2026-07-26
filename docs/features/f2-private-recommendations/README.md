# F2 — Private Recommendations

**Source of truth:** [F2 — Private Recommendations (0G)](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b)

0G. Sealed TEE inference that turns a user's request into a signed strategy **recommendation**,
with the enclave signature recovered off-chain to surface **provenance** (a real 0G TEE produced
it), the deterministic **validator** (I1–I12, reject-and-re-infer, never mutate), a labelled
`TEMPLATE_FALLBACK` when attempts are exhausted, and the **reviewer** (Gate 2, a stretch). Replay
protection is not needed here — there is no daemon and no book being stepped forward.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- Package: `packages/arbitration-sdk/` — 0G inference client + CLI (`npm run infer -- "…"`).
- PRD: `docs/prds/f2-private-recommendations.md`.

**⚠️ Gate 0 finding (2026-07-25):** the 0G provider does **not** sign our response text. The
out-of-band signature is EIP-191 over a provider attestation record
`reqHash:respHash:centralized:aliyun:certHash`; our output appears only as a hash we cannot
reproduce. Provenance (recover to the TEE signer) survives, and `recommendationId =
keccak256(signedText)` remains the payload id.
