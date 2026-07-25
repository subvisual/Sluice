import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { AquaProtocol, Maker, App, Token, MakerTokenBook } from "../generated/schema"
import { ERC20 } from "../generated/AquaRouter/ERC20"

export const PROTOCOL_ID = "aqua"
export const ZERO = BigInt.zero()

export function strategyEntityId(maker: Address, app: Address, strategyHash: Bytes): Bytes {
  return maker.concat(app).concat(strategyHash)
}

export function balanceId(strategyId: Bytes, token: Address): Bytes {
  return strategyId.concat(token)
}

export function bookId(maker: Address, token: Address): Bytes {
  return maker.concat(token)
}

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32())
}

export function getOrCreateProtocol(block: ethereum.Block): AquaProtocol {
  let protocol = AquaProtocol.load(PROTOCOL_ID)
  if (protocol == null) {
    protocol = new AquaProtocol(PROTOCOL_ID)
    protocol.strategyCount = 0
    protocol.liveStrategyCount = 0
    protocol.makerCount = 0
    protocol.appCount = 0
    protocol.fillCount = 0
    protocol.lastUpdatedBlock = block.number
    protocol.save()
  }
  return protocol
}

export function getOrCreateMaker(address: Address, block: ethereum.Block): Maker {
  let maker = Maker.load(address)
  if (maker == null) {
    maker = new Maker(address)
    maker.strategyCount = 0
    maker.liveStrategyCount = 0
    maker.firstSeenAt = block.timestamp
    maker.save()
    const protocol = getOrCreateProtocol(block)
    protocol.makerCount += 1
    protocol.save()
  }
  return maker
}

export function getOrCreateApp(address: Address, block: ethereum.Block): App {
  let app = App.load(address)
  if (app == null) {
    app = new App(address)
    app.strategyCount = 0
    app.liveStrategyCount = 0
    app.save()
    const protocol = getOrCreateProtocol(block)
    protocol.appCount += 1
    protocol.save()
  }
  return app
}

export function getOrCreateToken(address: Address): Token {
  let token = Token.load(address)
  if (token == null) {
    token = new Token(address)
    const erc20 = ERC20.bind(address)
    const symbol = erc20.try_symbol()
    if (!symbol.reverted) token.symbol = symbol.value
    const name = erc20.try_name()
    if (!name.reverted) token.name = name.value
    const decimals = erc20.try_decimals()
    if (!decimals.reverted) token.decimals = decimals.value
    token.save()
  }
  return token
}

export function getOrCreateBook(maker: Address, token: Address, block: ethereum.Block): MakerTokenBook {
  const id = bookId(maker, token)
  let book = MakerTokenBook.load(id)
  if (book == null) {
    book = new MakerTokenBook(id)
    book.maker = maker
    book.token = token
    book.committedVirtual = ZERO
    book.liveStrategyCount = 0
    book.updatedAt = block.timestamp
    book.save()
  }
  return book
}
