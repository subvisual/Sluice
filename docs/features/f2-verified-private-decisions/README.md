# F2 — Verified Private Decisions

**Source of truth:** [F2 — Verified Private Decisions (0G)](https://app.notion.com/p/3a8caae5863181609acbcfd69a5db06b)

0G. Sealed TEE inference for the allocation policy, per-decision enclave signatures verified
on-chain with `ecrecover`, the deterministic mandate gate, and the encrypted decision trace
in 0G Storage.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- PRD: `docs/prds/f2-verified-private-decisions.md`
- Issues: `docs/prds/f2-verified-private-decisions-issues.md`
- Feature-scoped ADRs: `docs/features/f2-verified-private-decisions/adr/`

The validator **rejects and re-infers** — it never mutates an enclave-signed decision. The
bytes verified on-chain must be byte-identical to the bytes executed.
