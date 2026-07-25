# F3 — The Agent's Eyes

**Source of truth:** [F3 — The Agent's Eyes (The Graph)](https://app.notion.com/p/3a8caae58631812cadd9df083e8d0dd9)

The Graph. Our own Aqua subgraph — `Strategy` keyed on a stable id, `Shipping` keyed on the
churning `strategyHash` — plus the contention metrics the agent derives off-chain from
indexed facts.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- PRD: `docs/prds/f3-agents-eyes.md`
- Issues: `docs/prds/f3-agents-eyes-issues.md`
- Feature-scoped ADRs: `docs/features/f3-agents-eyes/adr/`

Subgraphs index successful transactions only. Reverts emit no logs, so contention is
**derived**, never indexed. Never claim we index reverts or mempool data.
