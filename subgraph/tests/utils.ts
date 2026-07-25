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
