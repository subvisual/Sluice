# F1 — Aqua & the Strategy VM

1inch Aqua + SwapVM. F1 owns **the venue, the strategy language, and what fills what we ship**:
a **Base mainnet fork** at a pinned block running the *real, already-deployed* Aqua/SwapVM,
the **slot grammar** an LLM can safely fill (settled — Q2 closed 2026-07-25, G3-proven; the
program is a nest, salt → deadline → band → fee → curve, with four shipped templates:
`full-range`, `full-range-fee`, `banded`, `banded-fee` — one home,
`packages/arbitration-sdk/src/grammar.ts`), the deterministic **compiler**
(`SlotAssignment` → SwapVM bytecode, `packages/arbitration-sdk/src/swapvm.ts`), and the
**taker** — a funded EOA with one approval to `AquaSwapVMRouter`, driven by a Foundry broadcast
script (`contracts/script/Take.s.sol`: `quote()` then `swap()`, warns if they disagree), **not a
contract**, because a fork has no organic takers.

It does **not** own the recommendation itself (F2), the data behind it (F3), or the request flow.

This file holds only what is local: addresses, config paths, commands.

## Local

- PRD: `docs/prds/f1-aqua-strategy-vm.md` (not yet written)
- Issues: `docs/prds/f1-aqua-strategy-vm-issues.md` (not yet written)
- Feature-scoped ADRs: `docs/features/f1-aqua-strategy-vm/adr/`

Development and testing currently run against a **Base fork**, which shares Base's chainId — so a
`chainId` guard cannot tell fork from mainnet. Guard signing with a fork probe using an anvil-only
RPC method (`anvil_nodeInfo`, `hardhat_metadata`), **not `eth_getCode`**: the fork runs the same
Aqua deployment, so that bytecode is identical either way and proves nothing. Pair it with an
explicit `SLUICE_ALLOW_MAINNET` opt-in. Addresses are pinned in `config/addresses.8453.json`.

Provenance is `strategyHash = keccak256(strategy)` (`Aqua.sol:41`) — and the `strategy` bytes we
ship **are `abi.encode(Order{maker, traits, program})`**, so effectively
`keccak256(abi.encode(order))`; the bare program is never hashed (fork-proven,
`contracts/test/StrategyHashSemantics.t.sol`). Computed before signing. Aqua's preimage has no maker field, so identical **bytes** collide across
makers — key on `(maker, app, strategyHash)` — but a SwapVM Aqua-mode strategy embeds the maker
in the bytes, so identical **programs** from different makers do not collide. Emit a `SALT` in
every strategy — opcode `0x15` on the deployed Base router; opcode numbers are read from the
pinned `config/opcodes.8453.json`, never the 1inch master table. A docked hash is burned
permanently and amounts are not in the preimage, so a "resize" is a new strategy, never a
re-ship. Exits are `dock()` and `_deadline`; there is no daemon stepping a book.
