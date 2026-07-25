# Wiring & Delivery

**Source of truth:** [Wiring & Delivery — how the three features connect](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe)

The only shared context across F1–F3: the ubiquitous language, the **per-user request flow**
(no tick loop — the app runs on a user action, not a timer), the **two-transaction shape**, the
gates and build tracks, and the demo script.

Anything that changes how features connect belongs here and on the Notion page — not
duplicated into F1–F3.

## The shape everyone shares

- **Flow (per request, not a daemon):** REQUEST → SNAPSHOT → COMPOSE (0G) → VERIFY → VALIDATE →
  FALLBACK → COMPILE → REVIEW → PRESENT → FRESHEN → COMMIT → SHIP → PERSIST/INDEX.
- **tx1 (ours):** `RecommendationRegistry.commitRecommendation` — we sign and pay; an attestation.
- **tx2 (the user's):** `Multicall[ship(...), …]` on `AquaRouter` — the user signs and pays once;
  tokens never leave their wallet. tx1 must confirm before tx2 is built.
- **Keys:** the maker is the **user**. `SLUICE_COMMITTER_KEY` (ours, commits only) vs
  `SLUICE_OWNER_KEY` (registry admin, cold). No agent-controlled maker/owner key.
- **Gates:** G1 Aqua bytecode on the fork · G2 0G inference spike · G3 one real fill. Two tracks
  (A venue/agent, B subgraph/app), worked in dependency order — no timeboxed M1–M6.

## Local

- PRD: `docs/prds/wiring-delivery.md`
- Issues: `docs/prds/wiring-delivery-issues.md`
- Cross-cutting ADRs: `docs/adr/`
