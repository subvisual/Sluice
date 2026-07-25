# F1 — Aqua & the Strategy VM

**Source of truth:** [F1 — Aqua & the Strategy VM (1inch Aqua + SwapVM)](https://app.notion.com/p/3a8caae5863181459491dcb6e7e25a1b)

1inch Aqua + SwapVM. F1 owns **the venue, the strategy language, and what fills what we ship**:
a **Base mainnet fork** at a pinned block running the *real, already-deployed* Aqua/SwapVM
(`RecommendationRegistry` is the only contract we self-deploy, and it is not in the ship path),
the six-slot **strategy grammar** an LLM can safely fill (provisional until F1 Open Q2 settles
against the forked bytecode — do not pin a validator to a fixed slot table yet), the deterministic
**compiler** (`SlotAssignment` → SwapVM bytecode), and the **taker** — a funded EOA with one
approval to `AquaSwapVMRouter`, driven by a script (`packages/taker/src/drive.ts`), **not a
contract**, because a fork has no organic takers.

It does **not** own the recommendation itself (F2), the data behind it (F3), or the request flow.

Fetch the Notion page before planning work here. This file holds only what is local:
addresses, config paths, commands.

## Local

- PRD: `docs/prds/f1-aqua-strategy-vm.md`
- Issues: `docs/prds/f1-aqua-strategy-vm-issues.md`
- Feature-scoped ADRs: `docs/features/f1-aqua-strategy-vm/adr/`

Development and testing currently run against a **Base fork**, which shares Base's chainId — so a
`chainId` guard cannot tell fork from mainnet. Guard signing with a fork probe using an anvil-only
RPC method (`anvil_nodeInfo`, `hardhat_metadata`), **not `eth_getCode`**: the fork runs the same
Aqua deployment, so that bytecode is identical either way and proves nothing. Pair it with an
explicit `SLUICE_ALLOW_MAINNET` opt-in. Addresses are pinned in `config/addresses.8453.json`.

Provenance is `strategyHash = keccak256(strategy)` (`Aqua.sol:41`), where the shipped `strategy`
bytes **are `abi.encode(order)`** (`order = maker, traits, program`) — so effectively
`keccak256(abi.encode(order))`; the bare SwapVM program is never hashed directly (verified by a
real fork fill, PR #14). Computed before signing and checked by recompile-equality; key balances on
`(maker, app, strategyHash)` as Aqua does. *(Whether it also collides across makers is under review
— the shipped `abi.encode(order)` includes the maker.)* Emit a `SALT` instruction in every strategy
for uniqueness — opcode numbers live in `config/opcodes.8453.json` (deployed `SALT` is `0x15`, not
the master `0x02`); a docked hash is burned permanently and amounts are not in the preimage, so a
"resize" is a new strategy, never a re-ship. Exits are `dock()` and `_deadline`; there is no daemon
stepping a book.
