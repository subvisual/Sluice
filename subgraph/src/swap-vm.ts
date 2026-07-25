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
  const strategy = Strategy.load(strategyEntityId(event.params.maker, event.address, event.params.orderHash))
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
