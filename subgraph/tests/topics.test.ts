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

  test("Docked topic0", () => {
    assert.stringEquals(
      topic0("Docked(address,address,bytes32)"),
      "0xd173a1d140c154eb1ce9298d251d5eb8c4089cc2d16e70f1067bdc810c6fe004",
    )
  })

  test("Pulled topic0", () => {
    assert.stringEquals(
      topic0("Pulled(address,address,bytes32,address,uint256)"),
      "0x3ad61047071575417c75e3311e5d46ff042e292b5dd8769ff18b4b254098ca7a",
    )
  })

  test("Pushed topic0", () => {
    assert.stringEquals(
      topic0("Pushed(address,address,bytes32,address,uint256)"),
      "0x3f18354abbd5306dd1665c2c90f614a4559e39dd620d04fbe5458e613b6588f3",
    )
  })

  test("Swapped topic0", () => {
    assert.stringEquals(
      topic0("Swapped(bytes32,address,address,address,address,uint256,uint256)"),
      "0x54bc5c027d15d7aa8ae083f994ab4411d2f223291672ecd3a344f3d92dcaf8b2",
    )
  })
})
