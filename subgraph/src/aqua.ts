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
