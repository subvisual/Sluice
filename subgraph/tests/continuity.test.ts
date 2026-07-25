import { assert, describe, test, beforeEach, clearStore, createMockedFunction } from "matchstick-as/assembly/index"
import { BigInt, Bytes, Address, ethereum } from "@graphprotocol/graph-ts"
import { handleShipped, handlePushed, handlePulled, handleDocked } from "../src/aqua"
import { bookId } from "../src/helpers"
import { MAKER, APP, USDC, HASH_A, HASH_B, TX_2, shippedEvent, pushedEvent, pulledEvent, dockedEvent } from "./utils"

const DATA_A = Bytes.fromHexString("0x01")
const DATA_B = Bytes.fromHexString("0x02")
const TX_3 = Bytes.fromHexString("0x3333333333333333333333333333333333333333333333333333333333333333")
const N_10K = BigInt.fromI64(10_000_000_000)
const N_9K = BigInt.fromI64(9_000_000_000)
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
}

describe("maker book continuity across ship/fill/dock/ship", () => {
  beforeEach(() => {
    clearStore()
    setupTokenMocks()
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
