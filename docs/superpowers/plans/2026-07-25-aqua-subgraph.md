# Aqua Subgraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A generic 1inch Aqua protocol subgraph for Ethereum mainnet — strategy lifecycle, per-token virtual balances, per-maker committed totals, and SwapVM fills — deployable to Graph Studio.

**Architecture:** Two event-handler data sources (`AquaRouter` for Shipped/Docked/Pulled/Pushed, `AquaSwapVMRouter` for Swapped). All balance accounting is event-driven (ship() emits Pushed per token with initial amounts). Fills link to strategies because `Swapped.orderHash == strategyHash` for Aqua-mode orders. Spec: `docs/superpowers/specs/2026-07-25-aqua-subgraph-design.md`.

**Tech Stack:** The Graph (specVersion 1.2.0, apiVersion 0.0.9), AssemblyScript mappings, `@graphprotocol/graph-cli` 0.97.x, `@graphprotocol/graph-ts` 0.38.x, `matchstick-as` 0.6.x for unit tests, npm, Node ≥ 20.

## Global Constraints

- **Location:** everything this plan builds lives under `subgraph/` in the Sluice repo (`/Users/josevazf/projects/sluice`, branch `feat/aqua-subgraph`). Every relative path in every task (e.g. `src/aqua.ts`, `package.json`) means `subgraph/<path>`. Run all npm/graph commands from `/Users/josevazf/projects/sluice/subgraph`. Git commands work from there too (`git add` with the same relative paths). Do NOT create a `.gitignore` inside `subgraph/` — the repo root `.gitignore` already covers `node_modules/`, `subgraph/build/`, and `subgraph/generated/`; skip Task 1's `.gitignore` step.
- Addresses/startBlocks (Ethereum mainnet): `AquaRouter` = `0x499943e74fb0ce105688beee8ef2abec5d936d31` @ 23816437; `AquaSwapVMRouter` = `0x8fdd04dbf6111437b44bbca99c28882434e0958f` @ 23816440.
- ABIs are mirrored from the official `@1inch/aqua-sdk` `AQUA_ABI` / contract source — never invent signatures. All Aqua/SwapVM event params are **non-indexed**.
- Balance accounting is **event-only**: no `eth_call` in balance paths. The only contract calls allowed are `try_`-guarded ERC-20 metadata reads (`symbol`/`name`/`decimals`).
- Honesty constraints: no `starved`, no revert data, no PnL, no real-wallet-balance field anywhere in the schema.
- Entity identity: `Strategy.id = maker ++ app ++ strategyHash` (bytes concat); `StrategyBalance.id = strategyId ++ token`; `MakerTokenBook.id = maker ++ token`; `Fill.id`/`BalanceEvent.id = txHash ++ logIndex`.
- Every task ends with `npx graph test` (and where stated `npm run build`) passing, then a commit.

## File Structure

```
sluice/subgraph/
  package.json             # scripts: codegen, build, test, deploy
  tsconfig.json
  schema.graphql           # Task 1 (verbatim from spec §4)
  subgraph.yaml            # Task 1, mainnet
  networks.json            # Task 1, mainnet entry
  abis/Aqua.json           # Task 1, 4 events
  abis/SwapVM.json         # Task 1, Swapped event
  abis/ERC20.json          # Task 1, metadata views
  src/helpers.ts           # Task 2 — ids, get-or-create, constants
  src/aqua.ts              # Tasks 2–5 — core handlers
  src/swap-vm.ts           # Task 6 — Swapped handler
  tests/utils.ts           # Task 2 — mock event builders
  tests/aqua.test.ts       # Tasks 2–5
  tests/swap-vm.test.ts    # Task 6
  tests/topics.test.ts     # Task 6 — official topic0 assertions
  tests/continuity.test.ts # Task 7 — book invariant across lifecycle
  README.md                # Task 7
```

---

### Task 1: Project scaffold — manifest, schema, ABIs, codegen green

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `schema.graphql`, `subgraph.yaml`, `networks.json`, `abis/Aqua.json`, `abis/SwapVM.json`, `abis/ERC20.json`, `src/aqua.ts` (stub), `src/swap-vm.ts` (stub)

**Interfaces:**
- Produces: generated classes `Shipped`, `Docked`, `Pulled`, `Pushed` from `generated/AquaRouter/Aqua`; `Swapped` from `generated/AquaSwapVMRouter/SwapVM`; `ERC20` from `generated/AquaRouter/ERC20`; all schema entity classes from `generated/schema`. Handler names: `handleShipped`, `handleDocked`, `handlePulled`, `handlePushed` in `src/aqua.ts`; `handleSwapped` in `src/swap-vm.ts`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "aqua-subgraph",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "scripts": {
    "codegen": "graph codegen",
    "build": "graph build",
    "test": "graph test",
    "deploy": "graph deploy aqua-mainnet"
  },
  "dependencies": {
    "@graphprotocol/graph-cli": "^0.97.1",
    "@graphprotocol/graph-ts": "^0.38.0"
  },
  "devDependencies": {
    "matchstick-as": "^0.6.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json` and `.gitignore`**

`tsconfig.json`:
```json
{
  "extends": "@graphprotocol/graph-ts/types/tsconfig.base.json",
  "include": ["src", "tests"]
}
```

`.gitignore`:
```
node_modules/
generated/
build/
tests/.bin/
tests/.latest.json
.docker/
```

- [ ] **Step 3: Write `schema.graphql`** — copy verbatim from spec §4 (`docs/superpowers/specs/2026-07-25-aqua-subgraph-design.md`). It defines: enums `StrategyStatus`, `BalanceEventKind`; entities `AquaProtocol` (id `ID!`), `Maker`, `App`, `Token`, `Strategy`, `StrategyBalance`, `MakerTokenBook`, `Fill` (immutable), `BalanceEvent` (immutable). Do not rename fields — every later task and test uses those exact names.

- [ ] **Step 4: Write `abis/Aqua.json`** (mirrors official SDK ABI; all params non-indexed)

```json
[
  { "type": "event", "name": "Shipped", "anonymous": false, "inputs": [
    { "name": "maker", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "app", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "strategyHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" },
    { "name": "strategy", "type": "bytes", "indexed": false, "internalType": "bytes" } ] },
  { "type": "event", "name": "Docked", "anonymous": false, "inputs": [
    { "name": "maker", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "app", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "strategyHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" } ] },
  { "type": "event", "name": "Pulled", "anonymous": false, "inputs": [
    { "name": "maker", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "app", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "strategyHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" },
    { "name": "token", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" } ] },
  { "type": "event", "name": "Pushed", "anonymous": false, "inputs": [
    { "name": "maker", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "app", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "strategyHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" },
    { "name": "token", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "amount", "type": "uint256", "indexed": false, "internalType": "uint256" } ] }
]
```

- [ ] **Step 5: Write `abis/SwapVM.json`**

```json
[
  { "type": "event", "name": "Swapped", "anonymous": false, "inputs": [
    { "name": "orderHash", "type": "bytes32", "indexed": false, "internalType": "bytes32" },
    { "name": "maker", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "taker", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "tokenIn", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "tokenOut", "type": "address", "indexed": false, "internalType": "address" },
    { "name": "amountIn", "type": "uint256", "indexed": false, "internalType": "uint256" },
    { "name": "amountOut", "type": "uint256", "indexed": false, "internalType": "uint256" } ] }
]
```

- [ ] **Step 6: Write `abis/ERC20.json`**

```json
[
  { "type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [ { "name": "", "type": "string" } ] },
  { "type": "function", "name": "name", "stateMutability": "view", "inputs": [], "outputs": [ { "name": "", "type": "string" } ] },
  { "type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [ { "name": "", "type": "uint8" } ] }
]
```

- [ ] **Step 7: Write `subgraph.yaml`**

```yaml
specVersion: 1.2.0
description: Generic 1inch Aqua protocol subgraph — strategies, virtual balances, maker books, fills
repository: https://github.com/josevazf/aqua-subgraph
schema:
  file: ./schema.graphql
indexerHints:
  prune: auto
dataSources:
  - kind: ethereum
    name: AquaRouter
    network: mainnet
    source:
      address: "0x499943e74fb0ce105688beee8ef2abec5d936d31"
      abi: Aqua
      startBlock: 23816437
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities:
        - AquaProtocol
        - Maker
        - App
        - Token
        - Strategy
        - StrategyBalance
        - MakerTokenBook
        - BalanceEvent
      abis:
        - name: Aqua
          file: ./abis/Aqua.json
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: Shipped(address,address,bytes32,bytes)
          handler: handleShipped
        - event: Docked(address,address,bytes32)
          handler: handleDocked
        - event: Pulled(address,address,bytes32,address,uint256)
          handler: handlePulled
        - event: Pushed(address,address,bytes32,address,uint256)
          handler: handlePushed
      file: ./src/aqua.ts
  - kind: ethereum
    name: AquaSwapVMRouter
    network: mainnet
    source:
      address: "0x8fdd04dbf6111437b44bbca99c28882434e0958f"
      abi: SwapVM
      startBlock: 23816440
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.9
      language: wasm/assemblyscript
      entities:
        - AquaProtocol
        - Token
        - Strategy
        - Fill
      abis:
        - name: SwapVM
          file: ./abis/SwapVM.json
        - name: ERC20
          file: ./abis/ERC20.json
      eventHandlers:
        - event: Swapped(bytes32,address,address,address,address,uint256,uint256)
          handler: handleSwapped
      file: ./src/swap-vm.ts
```

- [ ] **Step 8: Write `networks.json`**

```json
{
  "mainnet": {
    "AquaRouter": { "address": "0x499943e74fb0ce105688beee8ef2abec5d936d31", "startBlock": 23816437 },
    "AquaSwapVMRouter": { "address": "0x8fdd04dbf6111437b44bbca99c28882434e0958f", "startBlock": 23816440 }
  }
}
```

(Other chains use identical addresses — adding one is a new entry with that chain's deploy blocks; instructions land in the README in Task 7.)

- [ ] **Step 9: Write stub mappings so codegen/build pass**

`src/aqua.ts`:
```typescript
import { Shipped, Docked, Pulled, Pushed } from "../generated/AquaRouter/Aqua"

export function handleShipped(event: Shipped): void {}
export function handleDocked(event: Docked): void {}
export function handlePulled(event: Pulled): void {}
export function handlePushed(event: Pushed): void {}
```

`src/swap-vm.ts`:
```typescript
import { Swapped } from "../generated/AquaSwapVMRouter/SwapVM"

export function handleSwapped(event: Swapped): void {}
```

- [ ] **Step 10: Install and verify**

Run: `npm install && npm run codegen && npm run build`
Expected: codegen writes `generated/`, build produces `build/` with two wasm modules, no errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore schema.graphql subgraph.yaml networks.json abis/ src/
git commit -m "feat: scaffold Aqua subgraph (manifest, schema, ABIs, stub handlers)"
```

---

### Task 2: Helpers + `handleShipped`

**Files:**
- Create: `src/helpers.ts`, `tests/utils.ts`, `tests/aqua.test.ts`
- Modify: `src/aqua.ts`

**Interfaces:**
- Consumes: generated classes from Task 1.
- Produces (used by Tasks 3–7):
  - `src/helpers.ts`: `ZERO: BigInt`; `PROTOCOL_ID: string` (= "aqua"); `strategyEntityId(maker: Address, app: Address, strategyHash: Bytes): Bytes`; `balanceId(strategyId: Bytes, token: Address): Bytes`; `bookId(maker: Address, token: Address): Bytes`; `eventId(event: ethereum.Event): Bytes`; `getOrCreateProtocol(block: ethereum.Block): AquaProtocol`; `getOrCreateMaker(address: Address, block: ethereum.Block): Maker`; `getOrCreateApp(address: Address): App`; `getOrCreateToken(address: Address): Token`; `getOrCreateBook(maker: Address, token: Address, block: ethereum.Block): MakerTokenBook`
  - `tests/utils.ts`: constants `MAKER`, `APP`, `TAKER`, `USDC`, `WETH`: `Address`; `HASH_A`, `HASH_B`: `Bytes`; `TX_2: Bytes` (an alternate tx hash); builders `shippedEvent(maker: Address, app: Address, hash: Bytes, data: Bytes): Shipped`; `dockedEvent(maker: Address, app: Address, hash: Bytes): Docked`; `pulledEvent(maker: Address, app: Address, hash: Bytes, token: Address, amount: BigInt): Pulled`; `pushedEvent(maker: Address, app: Address, hash: Bytes, token: Address, amount: BigInt): Pushed`; `swappedEvent(orderHash: Bytes, maker: Address, taker: Address, tokenIn: Address, tokenOut: Address, amountIn: BigInt, amountOut: BigInt): Swapped`

**Note for all tests:** `newMockEvent()` gives every mock event the same default `transaction.hash`, so a `pushedEvent` following a `shippedEvent` is "same tx" by default (that is exactly the ship-funding case). To simulate a *later* push, set `e.transaction.hash = TX_2` on the event before handling.

- [ ] **Step 1: Write `tests/utils.ts`**

```typescript
import { newMockEvent } from "matchstick-as/assembly/index"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { Shipped, Docked, Pulled, Pushed } from "../generated/AquaRouter/Aqua"
import { Swapped } from "../generated/AquaSwapVMRouter/SwapVM"

export const MAKER = Address.fromString("0x0000000000000000000000000000000000000101")
export const APP = Address.fromString("0x0000000000000000000000000000000000000202")
export const TAKER = Address.fromString("0x0000000000000000000000000000000000000505")
export const USDC = Address.fromString("0x0000000000000000000000000000000000000303")
export const WETH = Address.fromString("0x0000000000000000000000000000000000000404")
export const HASH_A = Bytes.fromHexString("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
export const HASH_B = Bytes.fromHexString("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
export const TX_2 = Bytes.fromHexString("0x2222222222222222222222222222222222222222222222222222222222222222")

export function shippedEvent(maker: Address, app: Address, hash: Bytes, data: Bytes): Shipped {
  const e = changetype<Shipped>(newMockEvent())
  e.parameters = [
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
    new ethereum.EventParam("app", ethereum.Value.fromAddress(app)),
    new ethereum.EventParam("strategyHash", ethereum.Value.fromFixedBytes(hash)),
    new ethereum.EventParam("strategy", ethereum.Value.fromBytes(data)),
  ]
  return e
}

export function dockedEvent(maker: Address, app: Address, hash: Bytes): Docked {
  const e = changetype<Docked>(newMockEvent())
  e.parameters = [
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
    new ethereum.EventParam("app", ethereum.Value.fromAddress(app)),
    new ethereum.EventParam("strategyHash", ethereum.Value.fromFixedBytes(hash)),
  ]
  return e
}

export function pulledEvent(maker: Address, app: Address, hash: Bytes, token: Address, amount: BigInt): Pulled {
  const e = changetype<Pulled>(newMockEvent())
  e.parameters = [
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
    new ethereum.EventParam("app", ethereum.Value.fromAddress(app)),
    new ethereum.EventParam("strategyHash", ethereum.Value.fromFixedBytes(hash)),
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token)),
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount)),
  ]
  return e
}

export function pushedEvent(maker: Address, app: Address, hash: Bytes, token: Address, amount: BigInt): Pushed {
  const e = changetype<Pushed>(newMockEvent())
  e.parameters = [
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
    new ethereum.EventParam("app", ethereum.Value.fromAddress(app)),
    new ethereum.EventParam("strategyHash", ethereum.Value.fromFixedBytes(hash)),
    new ethereum.EventParam("token", ethereum.Value.fromAddress(token)),
    new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(amount)),
  ]
  return e
}

export function swappedEvent(orderHash: Bytes, maker: Address, taker: Address, tokenIn: Address, tokenOut: Address, amountIn: BigInt, amountOut: BigInt): Swapped {
  const e = changetype<Swapped>(newMockEvent())
  e.parameters = [
    new ethereum.EventParam("orderHash", ethereum.Value.fromFixedBytes(orderHash)),
    new ethereum.EventParam("maker", ethereum.Value.fromAddress(maker)),
    new ethereum.EventParam("taker", ethereum.Value.fromAddress(taker)),
    new ethereum.EventParam("tokenIn", ethereum.Value.fromAddress(tokenIn)),
    new ethereum.EventParam("tokenOut", ethereum.Value.fromAddress(tokenOut)),
    new ethereum.EventParam("amountIn", ethereum.Value.fromUnsignedBigInt(amountIn)),
    new ethereum.EventParam("amountOut", ethereum.Value.fromUnsignedBigInt(amountOut)),
  ]
  return e
}
```

- [ ] **Step 2: Write the failing test in `tests/aqua.test.ts`**

```typescript
import { assert, describe, test, beforeEach, clearStore } from "matchstick-as/assembly/index"
import { Bytes } from "@graphprotocol/graph-ts"
import { handleShipped } from "../src/aqua"
import { strategyEntityId } from "../src/helpers"
import { MAKER, APP, HASH_A, shippedEvent } from "./utils"

const STRATEGY_DATA = Bytes.fromHexString("0xdeadbeef")

describe("handleShipped", () => {
  beforeEach(() => {
    clearStore()
  })

  test("creates a LIVE Strategy and bumps counters", () => {
    handleShipped(shippedEvent(MAKER, APP, HASH_A, STRATEGY_DATA))

    const id = strategyEntityId(MAKER, APP, HASH_A).toHexString()
    assert.entityCount("Strategy", 1)
    assert.fieldEquals("Strategy", id, "status", "LIVE")
    assert.fieldEquals("Strategy", id, "strategyHash", HASH_A.toHexString())
    assert.fieldEquals("Strategy", id, "strategyData", STRATEGY_DATA.toHexString())
    assert.fieldEquals("Strategy", id, "maker", MAKER.toHexString())
    assert.fieldEquals("Strategy", id, "app", APP.toHexString())
    assert.fieldEquals("Strategy", id, "fillCount", "0")

    assert.fieldEquals("Maker", MAKER.toHexString(), "strategyCount", "1")
    assert.fieldEquals("Maker", MAKER.toHexString(), "liveStrategyCount", "1")
    assert.fieldEquals("App", APP.toHexString(), "strategyCount", "1")
    assert.fieldEquals("AquaProtocol", "aqua", "strategyCount", "1")
    assert.fieldEquals("AquaProtocol", "aqua", "liveStrategyCount", "1")
    assert.fieldEquals("AquaProtocol", "aqua", "makerCount", "1")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx graph test aqua`
Expected: FAIL (helpers module missing / handler is a stub, `entityCount` 0 ≠ 1).

- [ ] **Step 4: Write `src/helpers.ts`**

```typescript
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { AquaProtocol, Maker, App, Token, MakerTokenBook } from "../generated/schema"
import { ERC20 } from "../generated/AquaRouter/ERC20"

export const PROTOCOL_ID = "aqua"
export const ZERO = BigInt.zero()

export function strategyEntityId(maker: Address, app: Address, strategyHash: Bytes): Bytes {
  return maker.concat(app).concat(strategyHash)
}

export function balanceId(strategyId: Bytes, token: Address): Bytes {
  return strategyId.concat(token)
}

export function bookId(maker: Address, token: Address): Bytes {
  return maker.concat(token)
}

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32())
}

export function getOrCreateProtocol(block: ethereum.Block): AquaProtocol {
  let protocol = AquaProtocol.load(PROTOCOL_ID)
  if (protocol == null) {
    protocol = new AquaProtocol(PROTOCOL_ID)
    protocol.strategyCount = 0
    protocol.liveStrategyCount = 0
    protocol.makerCount = 0
    protocol.appCount = 0
    protocol.fillCount = 0
    protocol.lastUpdatedBlock = block.number
    protocol.save()
  }
  return protocol
}

export function getOrCreateMaker(address: Address, block: ethereum.Block): Maker {
  let maker = Maker.load(address)
  if (maker == null) {
    maker = new Maker(address)
    maker.strategyCount = 0
    maker.liveStrategyCount = 0
    maker.firstSeenAt = block.timestamp
    maker.save()
    const protocol = getOrCreateProtocol(block)
    protocol.makerCount += 1
    protocol.save()
  }
  return maker
}

export function getOrCreateApp(address: Address): App {
  let app = App.load(address)
  if (app == null) {
    app = new App(address)
    app.strategyCount = 0
    app.liveStrategyCount = 0
    app.save()
    const protocol = AquaProtocol.load(PROTOCOL_ID)
    if (protocol != null) {
      protocol.appCount += 1
      protocol.save()
    }
  }
  return app
}

export function getOrCreateToken(address: Address): Token {
  let token = Token.load(address)
  if (token == null) {
    token = new Token(address)
    const erc20 = ERC20.bind(address)
    const symbol = erc20.try_symbol()
    if (!symbol.reverted) token.symbol = symbol.value
    const name = erc20.try_name()
    if (!name.reverted) token.name = name.value
    const decimals = erc20.try_decimals()
    if (!decimals.reverted) token.decimals = decimals.value
    token.save()
  }
  return token
}

export function getOrCreateBook(maker: Address, token: Address, block: ethereum.Block): MakerTokenBook {
  const id = bookId(maker, token)
  let book = MakerTokenBook.load(id)
  if (book == null) {
    book = new MakerTokenBook(id)
    book.maker = maker
    book.token = token
    book.committedVirtual = ZERO
    book.liveStrategyCount = 0
    book.updatedAt = block.timestamp
    book.save()
  }
  return book
}
```

- [ ] **Step 5: Implement `handleShipped` in `src/aqua.ts`** (replace the stub; keep the other stubs)

```typescript
import { Shipped, Docked, Pulled, Pushed } from "../generated/AquaRouter/Aqua"
import { Strategy } from "../generated/schema"
import { strategyEntityId, getOrCreateProtocol, getOrCreateMaker, getOrCreateApp } from "./helpers"

export function handleShipped(event: Shipped): void {
  const protocol = getOrCreateProtocol(event.block)
  const maker = getOrCreateMaker(event.params.maker, event.block)
  const app = getOrCreateApp(event.params.app)

  const strategy = new Strategy(strategyEntityId(event.params.maker, event.params.app, event.params.strategyHash))
  strategy.strategyHash = event.params.strategyHash
  strategy.maker = maker.id
  strategy.app = app.id
  strategy.strategyData = event.params.strategy
  strategy.status = "LIVE"
  strategy.tokenAddresses = []
  strategy.fillCount = 0
  strategy.pullCount = 0
  strategy.pushCount = 0
  strategy.shippedAt = event.block.timestamp
  strategy.shippedAtBlock = event.block.number
  strategy.shippedTx = event.transaction.hash
  strategy.save()

  maker.strategyCount += 1
  maker.liveStrategyCount += 1
  maker.save()

  app.strategyCount += 1
  app.liveStrategyCount += 1
  app.save()

  // reload: getOrCreateMaker may have bumped makerCount on the stored copy
  const freshProtocol = getOrCreateProtocol(event.block)
  freshProtocol.strategyCount += 1
  freshProtocol.liveStrategyCount += 1
  freshProtocol.lastUpdatedBlock = event.block.number
  freshProtocol.save()
}

export function handleDocked(event: Docked): void {}
export function handlePulled(event: Pulled): void {}
export function handlePushed(event: Pushed): void {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx graph test aqua`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/helpers.ts src/aqua.ts tests/utils.ts tests/aqua.test.ts
git commit -m "feat: handleShipped + entity helpers with tests"
```

---

### Task 3: `handlePushed` — ship funding vs standalone push

**Files:**
- Modify: `src/aqua.ts`, `tests/aqua.test.ts`

**Interfaces:**
- Consumes: helpers and builders from Task 2 (`balanceId`, `getOrCreateToken`, `getOrCreateBook`, `eventId`, `ZERO`, `pushedEvent`, `TX_2`).
- Produces: `StrategyBalance` and `MakerTokenBook` rows that Tasks 4–5 mutate; `BalanceEvent` rows with kinds `SHIP_FUND` / `PUSH`.

- [ ] **Step 1: Add failing tests to `tests/aqua.test.ts`**

```typescript
import { BigInt } from "@graphprotocol/graph-ts"
import { handlePushed } from "../src/aqua"
import { balanceId, bookId } from "../src/helpers"
import { USDC, WETH, TX_2, pushedEvent } from "./utils"

const N_10K = BigInt.fromI64(10_000_000_000) // 10,000 USDC (6 decimals)
const N_1K = BigInt.fromI64(1_000_000_000)

describe("handlePushed", () => {
  beforeEach(() => {
    clearStore()
    handleShipped(shippedEvent(MAKER, APP, HASH_A, STRATEGY_DATA))
  })

  test("Pushed in the ship tx is SHIP_FUND and initializes the balance", () => {
    handlePushed(pushedEvent(MAKER, APP, HASH_A, USDC, N_10K))

    const sid = strategyEntityId(MAKER, APP, HASH_A)
    const bid = balanceId(sid, USDC).toHexString()
    assert.fieldEquals("StrategyBalance", bid, "virtualBalance", N_10K.toString())
    assert.fieldEquals("StrategyBalance", bid, "initialVirtual", N_10K.toString())
    assert.fieldEquals("StrategyBalance", bid, "totalPushed", "0")
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "committedVirtual", N_10K.toString())
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "liveStrategyCount", "1")
    assert.fieldEquals("Strategy", sid.toHexString(), "pushCount", "0")
    assert.entityCount("BalanceEvent", 1)
  })

  test("Pushed in a later tx is PUSH and increments the balance", () => {
    handlePushed(pushedEvent(MAKER, APP, HASH_A, USDC, N_10K))
    const later = pushedEvent(MAKER, APP, HASH_A, USDC, N_1K)
    later.transaction.hash = TX_2
    handlePushed(later)

    const sid = strategyEntityId(MAKER, APP, HASH_A)
    const bid = balanceId(sid, USDC).toHexString()
    assert.fieldEquals("StrategyBalance", bid, "virtualBalance", N_10K.plus(N_1K).toString())
    assert.fieldEquals("StrategyBalance", bid, "initialVirtual", N_10K.toString())
    assert.fieldEquals("StrategyBalance", bid, "totalPushed", N_1K.toString())
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "committedVirtual", N_10K.plus(N_1K).toString())
    assert.fieldEquals("Strategy", sid.toHexString(), "pushCount", "1")
    assert.entityCount("BalanceEvent", 2)
  })

  test("Pushed for an unknown strategy is ignored", () => {
    handlePushed(pushedEvent(MAKER, APP, HASH_B, USDC, N_1K))
    assert.entityCount("StrategyBalance", 0)
    assert.entityCount("BalanceEvent", 0)
  })

  test("two SHIP_FUND pushes record both tokens on the strategy", () => {
    handlePushed(pushedEvent(MAKER, APP, HASH_A, USDC, N_10K))
    handlePushed(pushedEvent(MAKER, APP, HASH_A, WETH, N_1K))
    const sid = strategyEntityId(MAKER, APP, HASH_A)
    assert.fieldEquals("Strategy", sid.toHexString(), "tokenAddresses",
      "[" + USDC.toHexString() + ", " + WETH.toHexString() + "]")
    assert.entityCount("StrategyBalance", 2)
  })
})
```

(Reuse `MAKER`, `APP`, `HASH_A`, `HASH_B`, `shippedEvent`, `handleShipped`, `strategyEntityId`, `STRATEGY_DATA`, `assert`, `describe`, `test`, `beforeEach`, `clearStore` imports already present in the file from Task 2 — merge import lists.)

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx graph test aqua`
Expected: Task 2's test still PASSES; the four new tests FAIL (stub handler creates nothing).

- [ ] **Step 3: Implement `handlePushed` in `src/aqua.ts`**

```typescript
import { Strategy, StrategyBalance, BalanceEvent } from "../generated/schema"
import { Address } from "@graphprotocol/graph-ts"
import {
  strategyEntityId, balanceId, eventId, ZERO,
  getOrCreateProtocol, getOrCreateMaker, getOrCreateApp, getOrCreateToken, getOrCreateBook,
} from "./helpers"

export function handlePushed(event: Pushed): void {
  const strategyId = strategyEntityId(event.params.maker, event.params.app, event.params.strategyHash)
  const strategy = Strategy.load(strategyId)
  if (strategy == null) return // strategy predates indexing or was never shipped; nothing to account

  const token = getOrCreateToken(event.params.token)
  const book = getOrCreateBook(event.params.maker, event.params.token, event.block)
  const bid = balanceId(strategyId, event.params.token)
  let balance = StrategyBalance.load(bid)
  let kind: string

  if (balance == null) {
    if (strategy.shippedTx != event.transaction.hash) return // push to a token the ship never funded: contract prevents this
    kind = "SHIP_FUND"
    balance = new StrategyBalance(bid)
    balance.strategy = strategy.id
    balance.token = token.id
    balance.virtualBalance = event.params.amount
    balance.initialVirtual = event.params.amount
    balance.totalPulled = ZERO
    balance.totalPushed = ZERO
    const tokens = strategy.tokenAddresses
    tokens.push(event.params.token)
    strategy.tokenAddresses = tokens
    book.liveStrategyCount += 1
  } else {
    kind = "PUSH"
    balance.virtualBalance = balance.virtualBalance.plus(event.params.amount)
    balance.totalPushed = balance.totalPushed.plus(event.params.amount)
    strategy.pushCount += 1
  }

  balance.updatedAt = event.block.timestamp
  balance.save()
  strategy.save()

  book.committedVirtual = book.committedVirtual.plus(event.params.amount)
  book.updatedAt = event.block.timestamp
  book.save()

  const be = new BalanceEvent(eventId(event))
  be.strategy = strategy.id
  be.token = token.id
  be.kind = kind
  be.amount = event.params.amount
  be.balanceAfter = balance.virtualBalance
  be.ts = event.block.timestamp
  be.block = event.block.number
  be.tx = event.transaction.hash
  be.save()
}
```

**Gotcha:** in the SHIP_FUND branch the two `Pushed` events for two tokens share one tx and adjacent logIndexes — `eventId` uses `logIndex`, but `newMockEvent()` reuses the same logIndex. In the two-token test, set `e.logIndex = BigInt.fromI32(2)` on the second event if `BalanceEvent` ids collide (matchstick will overwrite silently; the `entityCount("StrategyBalance", 2)` assertion is unaffected, but fix the second event's logIndex anyway so `BalanceEvent` count assertions stay meaningful).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx graph test aqua`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/aqua.ts tests/aqua.test.ts
git commit -m "feat: handlePushed with SHIP_FUND/PUSH accounting"
```

---

### Task 4: `handlePulled`

**Files:**
- Modify: `src/aqua.ts`, `tests/aqua.test.ts`

**Interfaces:**
- Consumes: Task 3's `StrategyBalance`/`MakerTokenBook` rows; `pulledEvent` builder.
- Produces: decremented balances and `BalanceEvent(PULL)` rows relied on by Task 5's dock math and Task 7's continuity test.

- [ ] **Step 1: Add failing tests**

```typescript
import { handlePulled } from "../src/aqua"
import { pulledEvent } from "./utils"

describe("handlePulled", () => {
  beforeEach(() => {
    clearStore()
    handleShipped(shippedEvent(MAKER, APP, HASH_A, STRATEGY_DATA))
    handlePushed(pushedEvent(MAKER, APP, HASH_A, USDC, N_10K))
  })

  test("decrements balance and book, records PULL", () => {
    const pull = pulledEvent(MAKER, APP, HASH_A, USDC, N_1K)
    pull.transaction.hash = TX_2
    handlePulled(pull)

    const sid = strategyEntityId(MAKER, APP, HASH_A)
    const bid = balanceId(sid, USDC).toHexString()
    assert.fieldEquals("StrategyBalance", bid, "virtualBalance", N_10K.minus(N_1K).toString())
    assert.fieldEquals("StrategyBalance", bid, "totalPulled", N_1K.toString())
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "committedVirtual", N_10K.minus(N_1K).toString())
    assert.fieldEquals("Strategy", sid.toHexString(), "pullCount", "1")
    assert.entityCount("BalanceEvent", 2) // SHIP_FUND + PULL
  })

  test("Pulled for an unknown strategy is ignored", () => {
    handlePulled(pulledEvent(MAKER, APP, HASH_B, USDC, N_1K))
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "committedVirtual", N_10K.toString())
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx graph test aqua`
Expected: new tests FAIL, prior tests PASS.

- [ ] **Step 3: Implement `handlePulled` in `src/aqua.ts`**

```typescript
export function handlePulled(event: Pulled): void {
  const strategyId = strategyEntityId(event.params.maker, event.params.app, event.params.strategyHash)
  const strategy = Strategy.load(strategyId)
  if (strategy == null) return

  const bid = balanceId(strategyId, event.params.token)
  const balance = StrategyBalance.load(bid)
  if (balance == null) return // contract enforces balance existence; guard for pre-index strategies

  balance.virtualBalance = balance.virtualBalance.minus(event.params.amount)
  balance.totalPulled = balance.totalPulled.plus(event.params.amount)
  balance.updatedAt = event.block.timestamp
  balance.save()

  strategy.pullCount += 1
  strategy.save()

  const book = getOrCreateBook(event.params.maker, event.params.token, event.block)
  book.committedVirtual = book.committedVirtual.minus(event.params.amount)
  book.updatedAt = event.block.timestamp
  book.save()

  const be = new BalanceEvent(eventId(event))
  be.strategy = strategy.id
  be.token = getOrCreateToken(event.params.token).id
  be.kind = "PULL"
  be.amount = event.params.amount
  be.balanceAfter = balance.virtualBalance
  be.ts = event.block.timestamp
  be.block = event.block.number
  be.tx = event.transaction.hash
  be.save()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx graph test aqua`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aqua.ts tests/aqua.test.ts
git commit -m "feat: handlePulled with balance/book decrement"
```

---

### Task 5: `handleDocked`

**Files:**
- Modify: `src/aqua.ts`, `tests/aqua.test.ts`

**Interfaces:**
- Consumes: `strategy.tokenAddresses` populated by Task 3; `dockedEvent` builder.
- Produces: DOCKED strategies with zeroed balances — Task 6's linkage test and Task 7's continuity test depend on the book math being "subtract *remaining*, not initial".

- [ ] **Step 1: Add failing tests**

```typescript
import { handleDocked } from "../src/aqua"
import { dockedEvent } from "./utils"

describe("handleDocked", () => {
  beforeEach(() => {
    clearStore()
    handleShipped(shippedEvent(MAKER, APP, HASH_A, STRATEGY_DATA))
    handlePushed(pushedEvent(MAKER, APP, HASH_A, USDC, N_10K))
  })

  test("zeroes balances, subtracts remaining (not initial) from book, flips status", () => {
    const pull = pulledEvent(MAKER, APP, HASH_A, USDC, N_1K)
    pull.transaction.hash = TX_2
    handlePulled(pull) // remaining = 9,000

    const dock = dockedEvent(MAKER, APP, HASH_A)
    dock.transaction.hash = TX_2
    handleDocked(dock)

    const sid = strategyEntityId(MAKER, APP, HASH_A)
    const bid = balanceId(sid, USDC).toHexString()
    assert.fieldEquals("Strategy", sid.toHexString(), "status", "DOCKED")
    assert.fieldEquals("Strategy", sid.toHexString(), "dockedTx", TX_2.toHexString())
    assert.fieldEquals("StrategyBalance", bid, "virtualBalance", "0")
    assert.fieldEquals("StrategyBalance", bid, "initialVirtual", N_10K.toString()) // history preserved
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "committedVirtual", "0")
    assert.fieldEquals("MakerTokenBook", bookId(MAKER, USDC).toHexString(), "liveStrategyCount", "0")
    assert.fieldEquals("Maker", MAKER.toHexString(), "liveStrategyCount", "0")
    assert.fieldEquals("Maker", MAKER.toHexString(), "strategyCount", "1")
    assert.fieldEquals("AquaProtocol", "aqua", "liveStrategyCount", "0")
  })

  test("Docked for an unknown strategy is ignored", () => {
    handleDocked(dockedEvent(MAKER, APP, HASH_B))
    assert.fieldEquals("AquaProtocol", "aqua", "liveStrategyCount", "1")
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx graph test aqua`
Expected: new tests FAIL, prior tests PASS.

- [ ] **Step 3: Implement `handleDocked` in `src/aqua.ts`**

```typescript
export function handleDocked(event: Docked): void {
  const strategyId = strategyEntityId(event.params.maker, event.params.app, event.params.strategyHash)
  const strategy = Strategy.load(strategyId)
  if (strategy == null) return

  const tokens = strategy.tokenAddresses
  for (let i = 0; i < tokens.length; i++) {
    const tokenAddress = Address.fromBytes(tokens[i])
    const balance = StrategyBalance.load(balanceId(strategyId, tokenAddress))
    if (balance == null) continue
    const book = getOrCreateBook(event.params.maker, tokenAddress, event.block)
    book.committedVirtual = book.committedVirtual.minus(balance.virtualBalance)
    book.liveStrategyCount -= 1
    book.updatedAt = event.block.timestamp
    book.save()
    balance.virtualBalance = ZERO
    balance.updatedAt = event.block.timestamp
    balance.save()
  }

  strategy.status = "DOCKED"
  strategy.dockedAt = event.block.timestamp
  strategy.dockedAtBlock = event.block.number
  strategy.dockedTx = event.transaction.hash
  strategy.save()

  const maker = getOrCreateMaker(event.params.maker, event.block)
  maker.liveStrategyCount -= 1
  maker.save()

  const app = getOrCreateApp(event.params.app)
  app.liveStrategyCount -= 1
  app.save()

  const protocol = getOrCreateProtocol(event.block)
  protocol.liveStrategyCount -= 1
  protocol.lastUpdatedBlock = event.block.number
  protocol.save()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx graph test aqua`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aqua.ts tests/aqua.test.ts
git commit -m "feat: handleDocked zeroing balances and books"
```

---

### Task 6: `handleSwapped` (fills) + official topic assertions

**Files:**
- Modify: `src/swap-vm.ts`
- Create: `tests/swap-vm.test.ts`, `tests/topics.test.ts`

**Interfaces:**
- Consumes: `strategyEntityId`, `eventId`, `getOrCreateToken`, `getOrCreateProtocol` from helpers; `swappedEvent`, `shippedEvent` builders; `handleShipped` from `src/aqua`.
- Produces: `Fill` entities (nullable `strategy` link). Linkage key: `maker ++ dataSource.address() ++ orderHash` — in matchstick, `dataSource.address()` defaults to `0xA16081F360e3847006dB660bae1c6d1b2e17eC2A`, so the linked-fill test ships its strategy with that address as `app`.

- [ ] **Step 1: Write failing tests in `tests/swap-vm.test.ts`**

```typescript
import { assert, describe, test, beforeEach, clearStore } from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { handleShipped } from "../src/aqua"
import { handleSwapped } from "../src/swap-vm"
import { strategyEntityId, eventId } from "../src/helpers"
import { MAKER, TAKER, USDC, WETH, HASH_A, shippedEvent, swappedEvent } from "./utils"

// matchstick's default dataSource address — the "app" for linked fills
const SWAPVM = Address.fromString("0xA16081F360e3847006dB660bae1c6d1b2e17eC2A")
const IN = BigInt.fromI64(500_000_000)
const OUT = BigInt.fromI64(250_000_000_000_000)

describe("handleSwapped", () => {
  beforeEach(() => {
    clearStore()
  })

  test("links Fill to strategy when (maker, swapVM, orderHash) matches", () => {
    handleShipped(shippedEvent(MAKER, SWAPVM, HASH_A, Bytes.fromHexString("0xdeadbeef")))
    const swap = swappedEvent(HASH_A, MAKER, TAKER, USDC, WETH, IN, OUT)
    handleSwapped(swap)

    const fillId = eventId(swap).toHexString()
    const sid = strategyEntityId(MAKER, SWAPVM, HASH_A).toHexString()
    assert.entityCount("Fill", 1)
    assert.fieldEquals("Fill", fillId, "strategy", sid)
    assert.fieldEquals("Fill", fillId, "taker", TAKER.toHexString())
    assert.fieldEquals("Fill", fillId, "amountIn", IN.toString())
    assert.fieldEquals("Fill", fillId, "amountOut", OUT.toString())
    assert.fieldEquals("Strategy", sid, "fillCount", "1")
    assert.fieldEquals("AquaProtocol", "aqua", "fillCount", "1")
  })

  test("keeps Fill with null strategy when no match", () => {
    const swap = swappedEvent(HASH_A, MAKER, TAKER, USDC, WETH, IN, OUT)
    handleSwapped(swap)

    const fillId = eventId(swap).toHexString()
    assert.entityCount("Fill", 1)
    assert.fieldEquals("Fill", fillId, "orderHash", HASH_A.toHexString())
    // strategy link absent
    const fill = Fill.load(Bytes.fromHexString(fillId))
    assert.assertTrue(fill != null && fill!.strategy === null)
  })
})
```

(Add `import { Fill } from "../generated/schema"` for the null-link check.)

- [ ] **Step 2: Write `tests/topics.test.ts`** — assert our event signatures produce the official SDK topic0 hashes

```typescript
import { assert, describe, test } from "matchstick-as/assembly/index"
import { ByteArray, crypto } from "@graphprotocol/graph-ts"

function topic0(signature: string): string {
  return crypto.keccak256(ByteArray.fromUTF8(signature)).toHexString()
}

describe("event signatures match the official @1inch/aqua-sdk topics", () => {
  test("Shipped topic0", () => {
    assert.stringEquals(
      topic0("Shipped(address,address,bytes32,bytes)"),
      "0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0",
    )
  })
})
```

(One assertion is the tripwire for the whole ABI file: if the manifest's `Shipped` signature drifts from the SDK's, the deployed subgraph would silently index nothing — this fails loudly instead. Docked/Pulled/Pushed signatures live in the same manifest block and are covered by the integration reality that Task 8's build validates signatures against `abis/Aqua.json`.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx graph test`
Expected: swap-vm tests FAIL (stub); topics test PASSES already (it tests constants) — that is fine, it is a tripwire, not TDD.

- [ ] **Step 4: Implement `src/swap-vm.ts`**

```typescript
import { dataSource } from "@graphprotocol/graph-ts"
import { Swapped } from "../generated/AquaSwapVMRouter/SwapVM"
import { Fill, Strategy } from "../generated/schema"
import { strategyEntityId, eventId, getOrCreateProtocol, getOrCreateToken } from "./helpers"

export function handleSwapped(event: Swapped): void {
  const fill = new Fill(eventId(event))
  fill.orderHash = event.params.orderHash
  fill.maker = event.params.maker
  fill.taker = event.params.taker
  fill.tokenIn = getOrCreateToken(event.params.tokenIn).id
  fill.tokenOut = getOrCreateToken(event.params.tokenOut).id
  fill.amountIn = event.params.amountIn
  fill.amountOut = event.params.amountOut
  fill.ts = event.block.timestamp
  fill.block = event.block.number
  fill.tx = event.transaction.hash

  // Aqua-mode orders: orderHash == strategyHash, app == this SwapVM router
  const strategy = Strategy.load(strategyEntityId(event.params.maker, dataSource.address(), event.params.orderHash))
  if (strategy != null) {
    fill.strategy = strategy.id
    strategy.fillCount += 1
    strategy.save()
  }
  fill.save()

  const protocol = getOrCreateProtocol(event.block)
  protocol.fillCount += 1
  protocol.lastUpdatedBlock = event.block.number
  protocol.save()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx graph test`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add src/swap-vm.ts tests/swap-vm.test.ts tests/topics.test.ts
git commit -m "feat: handleSwapped fills with strategy linkage + topic tripwire"
```

---

### Task 7: Continuity test, README, final build

**Files:**
- Create: `tests/continuity.test.ts`, `README.md`

**Interfaces:**
- Consumes: everything above. No new production code — this task proves the spec §7.5 invariant and documents the deliverable.

- [ ] **Step 1: Write `tests/continuity.test.ts`** — the book stays Σ(live balances) through a full lifecycle

```typescript
import { assert, describe, test, beforeEach, clearStore } from "matchstick-as/assembly/index"
import { BigInt, Bytes } from "@graphprotocol/graph-ts"
import { handleShipped, handlePushed, handlePulled, handleDocked } from "../src/aqua"
import { bookId } from "../src/helpers"
import { MAKER, APP, USDC, HASH_A, HASH_B, TX_2, shippedEvent, pushedEvent, pulledEvent, dockedEvent } from "./utils"

const DATA_A = Bytes.fromHexString("0x01")
const DATA_B = Bytes.fromHexString("0x02")
const TX_3 = Bytes.fromHexString("0x3333333333333333333333333333333333333333333333333333333333333333")
const N_10K = BigInt.fromI64(10_000_000_000)
const N_9K = BigInt.fromI64(9_000_000_000)
const N_1K = BigInt.fromI64(1_000_000_000)

describe("maker book continuity across ship/fill/dock/ship", () => {
  beforeEach(() => {
    clearStore()
  })

  test("committedVirtual == sum of LIVE strategy balances at every step", () => {
    const book = bookId(MAKER, USDC).toHexString()

    // ship A with 10k
    handleShipped(shippedEvent(MAKER, APP, HASH_A, DATA_A))
    handlePushed(pushedEvent(MAKER, APP, HASH_A, USDC, N_10K))
    assert.fieldEquals("MakerTokenBook", book, "committedVirtual", N_10K.toString())

    // a fill drains 1k from A (the swap's own Pulled event)
    const pull = pulledEvent(MAKER, APP, HASH_A, USDC, N_1K)
    pull.transaction.hash = TX_2
    handlePulled(pull)
    assert.fieldEquals("MakerTokenBook", book, "committedVirtual", N_9K.toString())

    // ship B with 10k against the same balance — book is now over-committed on purpose
    const shipB = shippedEvent(MAKER, APP, HASH_B, DATA_B)
    shipB.transaction.hash = TX_3
    handleShipped(shipB)
    const fundB = pushedEvent(MAKER, APP, HASH_B, USDC, N_10K)
    fundB.transaction.hash = TX_3
    handlePushed(fundB)
    assert.fieldEquals("MakerTokenBook", book, "committedVirtual", N_9K.plus(N_10K).toString())
    assert.fieldEquals("MakerTokenBook", book, "liveStrategyCount", "2")

    // dock A — book drops by A's REMAINING 9k, not its initial 10k
    handleDocked(dockedEvent(MAKER, APP, HASH_A))
    assert.fieldEquals("MakerTokenBook", book, "committedVirtual", N_10K.toString())
    assert.fieldEquals("MakerTokenBook", book, "liveStrategyCount", "1")
    assert.fieldEquals("AquaProtocol", "aqua", "liveStrategyCount", "1")
    assert.fieldEquals("Maker", MAKER.toHexString(), "strategyCount", "2")
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx graph test continuity`
Expected: PASS (if it fails, the bug is real — fix the handler, not the test; the likely culprit is dock subtracting `initialVirtual` instead of `virtualBalance`).

- [ ] **Step 3: Write `README.md`**

Sections (write all of them, in this order):
1. **What this is** — generic 1inch Aqua protocol subgraph; strategy lifecycle, per-token virtual balances, per-maker committed totals (`MakerTokenBook`), SwapVM fills. Mainnet addresses + startBlocks table (copy from Global Constraints).
2. **What is deliberately not indexed** — reverted fills (no logs exist), real wallet balances (use a live `eth_call`), PnL (no price data in handlers), "starved"/contention flags (derive off-chain: over-commit ratio = `committedVirtual` ÷ live `balanceOf(maker)`).
3. **Entity model** — one-line-per-entity table mirroring spec §4, plus the identity rules (`Strategy.id = maker ++ app ++ strategyHash`; hashes are single-use per maker/app; `Swapped.orderHash == strategyHash` links fills).
4. **Example queries** — three fenced GraphQL blocks:

```graphql
# A maker's per-token committed book (over-commit numerator)
{
  makerTokenBooks(where: { maker: "0x..." }) {
    token { id symbol decimals }
    committedVirtual
    liveStrategyCount
  }
}
```

```graphql
# Live strategies with balances
{
  strategies(where: { status: LIVE }, orderBy: shippedAt, orderDirection: desc) {
    id strategyHash app { id }
    balances { token { symbol } virtualBalance initialVirtual totalPulled }
  }
}
```

```graphql
# Recent fills for a strategy
{
  fills(where: { strategy: "0x..." }, orderBy: ts, orderDirection: desc, first: 20) {
    taker tokenIn { symbol } tokenOut { symbol } amountIn amountOut ts
  }
}
```

5. **Build & test** — `npm install; npm run codegen; npm run build; npm test`.
6. **Deploying / other networks** — Studio deploy (`graph auth <key>; graph deploy <slug>`); to target another chain add an entry to `networks.json` (addresses are identical on the 12 supported mainnet chains; find that chain's deploy block first) and build with `graph build --network <name>`.
7. **Querying from AI agents (MCP)** — load The Graph MCP server instructions (`graphql://subgraph` resource) at conversation start; verify deployment activity with `get_deployment_30day_query_counts` before querying; query via `execute_query_by_subgraph_id` / `execute_query_by_ipfs_hash`. Placeholder line for this subgraph's Studio ID / IPFS hash, filled in after first deploy.
8. **References** — 1inch/aqua, 1inch/swap-vm, @1inch/aqua-sdk (ABI source of truth), and the design spec path.

- [ ] **Step 4: Full verification**

Run: `npm run codegen && npm run build && npx graph test`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add tests/continuity.test.ts README.md
git commit -m "test: lifecycle continuity invariant; docs: README with queries and MCP guidance"
```

---

## Post-plan (manual, with user)

- Deploy to Graph Studio: needs the user's Studio slug + deploy key (`graph auth`, `npm run deploy`). Then fill the README's MCP placeholder with the real subgraph ID / IPFS hash.
- Push the four §11 findings from the spec back to the Notion pages (batch update, per the project workflow agreement).
