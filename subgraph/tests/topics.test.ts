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
