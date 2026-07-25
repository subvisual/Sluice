# F2 — Verified Private Recommendations

**Source of truth:** [F2 — Verified Private Recommendations (0G)](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b)

0G. Sealed TEE inference that turns a user's request into a signed strategy **recommendation**,
per-recommendation enclave signatures verified on-chain (`RecommendationRegistry.commitRecommendation`),
the deterministic **validator** (reject-and-re-infer, never mutate), the **reviewer** (Gate 2,
a stretch), and the encrypted trace in 0G Storage. Replay protection is a **per-user nonce**, not
a global epoch — there is no daemon and no book being stepped forward.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- Package: `packages/arbitration-sdk/` — 0G inference client + CLI (`npm run infer -- "…"`).
- PRD: `docs/prds/f2-verified-private-recommendations.md` — regenerated after the pivot; see its
  **build-scope banner** (recommendation-only; verifiability deferred).
- Feature-scoped ADRs: `docs/features/f2-verified-private-recommendations/adr/`

**⚠️ Gate 0 finding (2026-07-25):** the 0G provider does **not** sign our response text. The
out-of-band signature is EIP-191 over a provider attestation record
`reqHash:respHash:centralized:aliyun:certHash`; our output appears only as a hash we cannot
reproduce. So "the enclave signs our framed bytes; slice the nonce from a fixed-width prefix;
`keccak256(signedText)` is our id" is **not implementable** as drafted — provenance (recover to the
registered TEE signer) survives, but binding our payload/nonce to the commit needs redesign before
`RecommendationRegistry` is built. See the "⚠️ Gate 0 update" block on the Notion page and
ADR-0001.
