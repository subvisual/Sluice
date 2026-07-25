# Wiring & Delivery

**Source of truth:** [Wiring & Delivery — how the three features connect](https://app.notion.com/p/3a8caae58631816d9aa0eb077e013ffe)

The only shared context across F1–F3: the ubiquitous language, the **per-user request flow**
(no tick loop — the app runs on a user action, not a timer), the **two-transaction shape**, the
gates and build tracks, and the demo script.

Anything that changes how features connect belongs here and on the Notion page — not
duplicated into F1–F3.

> **Current build scope (2026-07-25):** recommendation-only — VERIFY, COMMIT (tx1), PERSIST and the
> recommendation half of INDEX are deferred, so nothing touches the chain yet; the honest loop is
> *prompt → recommendation*. The two-transaction shape below is the durable target, not today's
> build. Scope detail lives on the Notion page.

## The shape everyone shares

- **Flow (per request, not a daemon):** GUARD → REQUEST → SNAPSHOT → COMPOSE (0G) → VERIFY →
  VALIDATE → FALLBACK → COMPILE → REVIEW → PRESENT → FRESHEN → COMMIT → SHIP → PERSIST → INDEX.
  **GUARD (step 0) is load-bearing:** the fork probe (`anvil_nodeInfo`) and `SLUICE_ALLOW_MAINNET`
  must agree or the request hard-aborts before any tx is built — a fork and Base share chainId
  8453, so asserting the chainId guards nothing.
- **tx1 (ours):** `RecommendationRegistry.commitRecommendation` — we sign and pay; an attestation.
- **tx2 (the user's):** `Multicall[ship(...), …]` on `AquaRouter` — the user signs and pays once;
  tokens never leave their wallet. **tx2 need not wait on tx1** — fire tx1 on acceptance and let the
  user sign tx2 immediately; if the commit is slow or fails, the position simply lands unlinked
  until the registry catches up. A degraded join beats a blocked signature; the binding is a
  derivation, not an enforcement.
- **Keys:** the maker is the **user**. `SLUICE_COMMITTER_KEY` (ours, commits only) vs
  `SLUICE_OWNER_KEY` (registry admin, cold). No agent-controlled maker/owner key.
- **Gates:** G1 Aqua bytecode on the fork · G2 0G inference spike · G3 one real fill. Two tracks
  (A venue/agent, B subgraph/app), worked in dependency order — no timeboxed M1–M6.
- **Delivery constraint (1inch):** proper Git commit history — no single big commit on the final
  day. It is the one prize requirement that cannot be satisfied retroactively, so it governs how we
  commit day-to-day. Detail on the Prize Strategy page.

## Local

- PRD: `docs/prds/wiring-delivery.md`
- Issues: `docs/prds/wiring-delivery-issues.md`
- Cross-cutting ADRs: `docs/adr/`
