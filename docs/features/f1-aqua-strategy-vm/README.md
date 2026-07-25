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
them apart. Guard with a **fork probe using an anvil-only RPC method** (`anvil_nodeInfo`,
`hardhat_metadata`) plus an explicit `SLUICE_ALLOW_MAINNET` opt-in, and hard-abort when they
disagree. **Not `eth_getCode`** — the fork runs the same Aqua deployment as mainnet, so the
bytecode at those addresses is identical on both and proves nothing. Addresses are pinned in
`config/addresses.8453.json`.

Provenance is `strategyHash = keccak256(strategy)` — the raw bytes, **no `abi.encode`**
(`Aqua.sol:41`) — computed before signing and checked by recompile-equality. The preimage
contains no maker, so hashes collide across users; key on `(maker, app, strategyHash)`. Emit a
`Salt` (`0x02`) in every strategy: a docked hash is burned permanently and amounts are not in the
preimage, so a "resize" is a new strategy, never a re-ship. Exits are `dock()` and `_deadline`;
there is no daemon stepping a book.
