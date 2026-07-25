// No "use client" — leaf of client trees (needs state for the fallback).

import Image from "next/image";
import { useState } from "react";
import { getAddress, type Address } from "viem";
import type { Position } from "@/lib/book";
import { CONFIG_CHAIN_ID, tokenBySymbol } from "@/lib/tokens";

/**
 * A token mark from the Trust Wallet assets repo, which keys art the same way
 * this app keys tokens: per chain, by that chain's address. Nothing is
 * vendored — pointing the app at another chain's `addresses.<chainId>.json`
 * resolves that chain's art with no asset changes here.
 *
 * Falls back to the dashed placeholder circle when the chain is unmapped, the
 * token has no art, or the network is down — so a missing icon degrades to
 * exactly the placeholder the design specifies, it doesn't break.
 */

/** Trust Wallet's directory names for the chains this app can point at. */
const CHAIN_SLUG: Record<number, string> = {
  1: "ethereum",
  8453: "base",
};

/**
 * Candidate art URLs, most-specific first: the configured chain's directory,
 * then `ethereum` — the repo's L2 directories are sparse, and a token's
 * canonical L1 deployment usually carries the art. A miss on every candidate
 * lands on the placeholder.
 */
export function tokenIconUrls(address: Address, chainId: number): string[] {
  let checksummed: Address;
  try {
    // The repo keys assets by EIP-55 checksummed address.
    checksummed = getAddress(address);
  } catch {
    return [];
  }
  const slugs = [...new Set([CHAIN_SLUG[chainId], "ethereum"])].filter(
    (s): s is string => s !== undefined,
  );
  return slugs.map(
    (slug) =>
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${checksummed}/logo.png`,
  );
}

/**
 * A position's pair as two overlapped marks — the same representation on the
 * dashboard cards and the detail sheet. A pair token isn't always a committed
 * leg (a limit sell commits only the token it sells), so resolution tries the
 * position's own legs first, then the address book.
 */
export function PairIcons({
  position,
  size = 30,
}: {
  position: Position;
  size?: number;
}) {
  const [first, second] = position.pair.split(" / ");
  const addressOf = (symbol: string) =>
    position.legs.find((l) => l.symbol === symbol)?.token ??
    tokenBySymbol(symbol)?.address;
  return (
    <div className="flex items-center">
      <TokenIcon address={addressOf(first)} symbol={first} size={size} />
      <TokenIcon
        address={addressOf(second)}
        symbol={second}
        size={size}
        className="-ml-[9px]"
      />
    </div>
  );
}

export function TokenIcon({
  address,
  symbol,
  size,
  className = "",
}: {
  address?: Address;
  symbol: string;
  size: number;
  className?: string;
}) {
  const [attempt, setAttempt] = useState(0);

  const urls = address ? tokenIconUrls(address, CONFIG_CHAIN_ID) : [];
  const url = urls[attempt];

  if (!url) {
    return (
      <span
        style={{ width: size, height: size, fontSize: size >= 30 ? 8 : 7.5 }}
        className={`flex flex-none items-center justify-center rounded-full border border-dashed border-slot-line bg-surface-2 font-mono text-muted-2 ${className}`}
      >
        {symbol}
      </span>
    );
  }

  return (
    <Image
      src={url}
      alt={`${symbol} mark`}
      width={size}
      height={size}
      // Served as-is: 30px marks gain nothing from the optimizer, and
      // bypassing it keeps remote images out of the optimizer's allowlist.
      unoptimized
      onError={() => setAttempt((a) => a + 1)}
      // Hairline outline so overlapped marks separate cleanly on white cards.
      className={`flex-none rounded-full border border-border bg-card ${className}`}
    />
  );
}
