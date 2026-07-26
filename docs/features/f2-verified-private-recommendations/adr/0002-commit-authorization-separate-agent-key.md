# Commit authorization: a separate agent key, because the enclave signer is shared

**Status:** accepted · 2026-07-25

> **⚠️ Vocabulary note (2026-07-25 Notion pivot):** F2 was reframed from "decisions" to
> "recommendations": `DecisionRegistry`→`RecommendationRegistry`, `commitDecision`→
> `commitRecommendation`, `BookDecision`→`StrategyRecommendation`, global epoch→per-user nonce,
> owner-as-maker→**user-as-maker**. The decision this ADR records **still holds** — the committer
> key stays separate from the shared enclave signer and from the owner; read it with the new nouns.
> (Note also ADR-0001's Gate 0 update: the enclave signs an attestation record, not our text.)

> **⚠️ Drift note (2026-07-26):** three statements in the historical body below are superseded and
> left intact for history. (1) "the signature covers only the **response text**" — Gate 0 proved it
> covers 0G's 5-field **attestation record** (`reqHash:respHash:centralized:aliyun:certHash`), not
> the response text; see ADR-0001's Gate 0 update. (2) `ownerFallbackDock` no longer exists in the
> registry design — it was a daemon-era function; under the composer framing the **user is the
> maker** and docks their own positions. (3) "epoch-fresh" reads as **per-user-nonce-fresh**
> (Notion F2 §2). The decision itself is unchanged.

`DecisionRegistry.commitDecision` is restricted to a **registered committer (agent) key**
(`onlyCommitter`), separate from the owner. The owner alone may `registerSigner`,
`registerCommitter`, and `ownerFallbackDock`.

## Why

The 0G enclave `teeSignerAddress` is generated per **provider**/per **boot** and the signature
covers only the **response text**. It is therefore **shared across every user of that
provider/model**. So `ecrecover(signedText) ∈ registeredSigners` proves *a real 0G TEE produced
this text* — not *our agent produced it*. Without more, an attacker could use their own 0G
account to elicit a valid-looking, enclave-signed `BookDecision` from the same provider and
submit it to our registry. Textual domain separation does not help: the attacker controls their
prompt and can echo any tag we choose.

## Decision

Two signatures, two distinct roles:

- **Enclave signature (on-chain, `ecrecover`):** provenance — the text was produced inside a
  real 0G TEE. Underpins the front-running-defence and "computed privately, not by the operator"
  claims.
- **Committer authorization (`msg.sender == registered agent`):** authorization — *our* agent
  chose to commit this specific TEE output. External parties cannot call `commitDecision` at all.

The committer key is **separate from the owner** so a leaked agent key cannot also trigger the
owner fallback / unwind path.

## Consequences

- External forgery via the shared signer is closed.
- The trust root is made explicit and defensible: the **agent (owner's key) is trusted for
  liveness and authorization**; the enclave signature + on-chain epoch/signature checks mean it
  cannot pass off a decision the TEE never produced, nor replay a stale one.
- The **mandate (I1–I14) remains enforced off-chain** by the honest agent — the registry does
  not run the validator. This is unchanged from the prior design and is stated honestly in the
  hybrid trust model (F2 §1). A malicious agent is out of scope: it is the owner's own key.
- Pitch line: *"the operator can halt the agent, but cannot fabricate an enclave-signed
  decision it didn't produce, nor replay an old one — every commit is TEE-produced, agent-
  authorized, epoch-fresh, and mandate-checked."*
