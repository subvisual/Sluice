// No "use client" — leaf of client trees (needs state for the fallback).

import Image from "next/image";
import { useState } from "react";
import { getAddress, type Address } from "viem";
import { CONFIG_CHAIN_ID } from "@/lib/tokens";

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

export function tokenIconUrl(address: Address, chainId: number): string | null {
  const slug = CHAIN_SLUG[chainId];
  if (!slug) return null;
  try {
    // The repo keys assets by EIP-55 checksummed address.
    return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${getAddress(address)}/logo.png`;
  } catch {
    return null;
  }
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
  const [failed, setFailed] = useState(false);

  const url = address ? tokenIconUrl(address, CONFIG_CHAIN_ID) : null;

  if (!url || failed) {
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
      onError={() => setFailed(true)}
      className={`flex-none rounded-full ${className}`}
    />
  );
}
