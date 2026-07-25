# F1 — Aqua & the Strategy VM

**Source of truth:** [F1 — Aqua & the Strategy VM (1inch Aqua + SwapVM)](https://app.notion.com/p/3a8caae5863181459491dcb6e7e25a1b)

1inch Aqua + SwapVM. F1 owns **the venue, the strategy language, and what fills what we ship**:
a **Base mainnet fork** at a pinned block running the *real, already-deployed* Aqua/SwapVM (we
self-deploy only our own contracts), the six-slot **strategy grammar** an LLM can safely fill,
the deterministic **compiler** (`SlotAssignment` → SwapVM bytecode), and `SluiceTaker.sol` — a
taker we build ourselves because a fork has no organic takers.

It does **not** own the recommendation itself (F2), the data behind it (F3), or the request flow.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- PRD: `docs/prds/f1-aqua-strategy-vm.md`
- Issues: `docs/prds/f1-aqua-strategy-vm-issues.md`
- Feature-scoped ADRs: `docs/features/f1-aqua-strategy-vm/adr/`

The venue is a **Base fork** — same chainId as Base mainnet, so a `chainId` guard cannot tell
them apart. Guard with a **fork probe** (`eth_getCode` against pinned addresses) plus an explicit
`SLUICE_ALLOW_MAINNET` opt-in. Addresses are pinned in `config/addresses.8453.json`; never
hardcode the real Aqua addresses (identical across chains). Provenance is
`strategyHash = keccak256(abi.encode(strategy))`, computed before signing and checked by
recompile-equality. Exits are `dock()` and `_deadline`; there is no daemon stepping a book.
