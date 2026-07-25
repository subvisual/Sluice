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
