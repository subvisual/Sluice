import { assert, describe, test, beforeEach, clearStore, createMockedFunction } from "matchstick-as/assembly/index"
import { Bytes, BigInt, Address, ethereum } from "@graphprotocol/graph-ts"
import { handleShipped, handlePushed } from "../src/aqua"
import { strategyEntityId, balanceId, bookId } from "../src/helpers"
import { MAKER, APP, HASH_A, HASH_B, USDC, WETH, TX_2, shippedEvent, pushedEvent } from "./utils"

const STRATEGY_DATA = Bytes.fromHexString("0xdeadbeef")
const N_10K = BigInt.fromI64(10_000_000_000) // 10,000 USDC (6 decimals)
const N_1K = BigInt.fromI64(1_000_000_000)

function mockTokenERC20(token: Address, symbol: string, name: string, decimals: i32): void {
  createMockedFunction(token, "symbol", "symbol():(string)")
    .returns([ethereum.Value.fromString(symbol)])
  createMockedFunction(token, "name", "name():(string)")
    .returns([ethereum.Value.fromString(name)])
  createMockedFunction(token, "decimals", "decimals():(uint8)")
    .returns([ethereum.Value.fromI32(decimals)])
}

function setupTokenMocks(): void {
  mockTokenERC20(USDC, "USDC", "USD Coin", 6)
  mockTokenERC20(WETH, "WETH", "Wrapped Ether", 18)
}

describe("handleShipped", () => {
  beforeEach(() => {
    clearStore()
    setupTokenMocks()
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

describe("handlePushed", () => {
  beforeEach(() => {
    clearStore()
    setupTokenMocks()
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
    const e = pushedEvent(MAKER, APP, HASH_A, WETH, N_1K)
    e.logIndex = BigInt.fromI32(2)
    handlePushed(e)
    const sid = strategyEntityId(MAKER, APP, HASH_A)
    assert.fieldEquals("Strategy", sid.toHexString(), "tokenAddresses",
      "[" + USDC.toHexString() + ", " + WETH.toHexString() + "]")
    assert.entityCount("StrategyBalance", 2)
  })
})
