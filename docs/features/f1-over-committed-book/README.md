# F1 — The Over-Committed Book

**Source of truth:** [F1 — The Over-Committed Book (1inch Aqua + SwapVM)](https://app.notion.com/p/3a8caae5863181459491dcb6e7e25a1b)

1inch Aqua + SwapVM. Self-deploying `AquaRouter` + `AquaSwapVMRouter` to a testnet (hour 0,
hard gate), the over-committed strategy book, and the taker we have to build ourselves to
produce any fills at all.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- PRD: `docs/prds/f1-over-committed-book.md`
- Issues: `docs/prds/f1-over-committed-book-issues.md`
- Feature-scoped ADRs: `docs/features/f1-over-committed-book/adr/`

Deployment addresses are pinned in one config file — never hardcode the mainnet addresses,
which are identical across 12 chains. Assert `chainId` at startup and before every tx.
