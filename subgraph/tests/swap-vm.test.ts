import { assert, describe, test, beforeEach, clearStore, createMockedFunction } from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { handleShipped } from "../src/aqua"
import { handleSwapped } from "../src/swap-vm"
import { strategyEntityId, eventId } from "../src/helpers"
import { MAKER, TAKER, USDC, WETH, HASH_A, shippedEvent, swappedEvent } from "./utils"
import { Fill } from "../generated/schema"

// matchstick's default dataSource address — the "app" for linked fills
const SWAPVM = Address.fromString("0xA16081F360e3847006dB660bae1c6d1b2e17eC2A")
const IN = BigInt.fromI64(500_000_000)
const OUT = BigInt.fromI64(250_000_000_000_000)

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

describe("handleSwapped", () => {
  beforeEach(() => {
    clearStore()
    setupTokenMocks()
  })

  test("links Fill to strategy when (maker, swapVM, orderHash) matches", () => {
    handleShipped(shippedEvent(MAKER, SWAPVM, HASH_A, Bytes.fromHexString("0xdeadbeef")))
    const swap = swappedEvent(HASH_A, MAKER, TAKER, USDC, WETH, IN, OUT)
    swap.address = SWAPVM
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
