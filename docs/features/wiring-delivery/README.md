# Wiring & Delivery

The only shared context across F1–F3: the ubiquitous language, the **per-user request flow**
(no tick loop — the app runs on a user action, not a timer), the **transaction shape**, the
gates and build tracks, and the demo script.

Anything that changes how features connect belongs here — not duplicated into F1–F3.

> **Current build (2026-07-26):** the loop is live end to end — *prompt → validated recommendation
> → compiled strategies → the user's ship `Multicall`* (PR #34), with the book read back through
> the subgraph. REVIEW (the reviewer agent) remains a stretch.

## The shape everyone shares

- **Flow (per request, not a daemon):** GUARD → REQUEST → SNAPSHOT → COMPOSE (0G) →
  VALIDATE → FALLBACK → COMPILE → REVIEW (stretch) → PRESENT → SHIP → INDEX.
  **GUARD (step 0) is load-bearing:** the fork probe (`anvil_nodeInfo`) and `SLUICE_ALLOW_MAINNET`
  must agree or the request hard-aborts before any tx is built — a fork and Base share chainId
  8453, so asserting the chainId guards nothing.
- **The one transaction (the user's):** `Multicall[ship(...), …]` on `AquaRouter` — the user signs
  and pays once; tokens never leave their wallet.
- **Keys:** the maker is the **user**. No agent-controlled maker/owner key.
- **Gates:** G1 Aqua bytecode on the fork · G2 0G inference spike · G3 one real fill. Two tracks
  (A venue/agent, B subgraph/app), worked in dependency order — no timeboxed M1–M6.
- **Delivery constraint (1inch):** proper Git commit history — no single big commit on the final
  day. It is the one prize requirement that cannot be satisfied retroactively, so it governs how we
  commit day-to-day. Detail on the Prize Strategy page.

## Local

- PRD: `docs/prds/wiring-delivery.md`
- Issues: `docs/prds/wiring-delivery-issues.md`
- Cross-cutting ADRs: `docs/adr/`
