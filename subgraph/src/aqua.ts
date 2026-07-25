import { Shipped, Docked, Pulled, Pushed } from "../generated/AquaRouter/Aqua"
import { Strategy, StrategyBalance, BalanceEvent } from "../generated/schema"
import { Address } from "@graphprotocol/graph-ts"
import {
  strategyEntityId, balanceId, eventId, ZERO,
  getOrCreateProtocol, getOrCreateMaker, getOrCreateApp, getOrCreateToken, getOrCreateBook,
} from "./helpers"

export function handleShipped(event: Shipped): void {
  const strategyId = strategyEntityId(event.params.maker, event.params.app, event.params.strategyHash)
  // ship()'s immutability check is per-token, so re-shipping an existing hash with an
  // empty or disjoint token set re-emits Shipped; don't let it overwrite the entity
  // (the new tokens' funding still lands via handlePushed's SHIP_FUND path)
  if (Strategy.load(strategyId) != null) return

  getOrCreateProtocol(event.block) // ensure the singleton exists before getOrCreateApp bumps appCount
  const maker = getOrCreateMaker(event.params.maker, event.block)
  const app = getOrCreateApp(event.params.app)

  const strategy = new Strategy(strategyId)
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

export function handleDocked(event: Docked): void {
  const strategyId = strategyEntityId(event.params.maker, event.params.app, event.params.strategyHash)
  const strategy = Strategy.load(strategyId)
  if (strategy == null) return
  if (strategy.status == "DOCKED") return // already docked: balances are zero, avoid double-decrementing live counters

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
    // push() to a never-funded token reverts (PushToNonActiveStrategyPrevented), so a
    // Pushed with no prior balance can only be ship() funding — including a re-ship of
    // the same hash with a disjoint token set (the immutability check is per-token)
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
