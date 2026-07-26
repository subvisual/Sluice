"use client";

import { erc20Abi, type Address } from "viem";
import { useReadContracts } from "wagmi";
import { TOKENS } from "./tokens";

/**
 * Live balances for every selectable token.
 *
 * Read straight from the chain rather than an index — the portfolio header has
 * to stay correct even when the subgraph lags.
 *
 * `undefined` for a token means "not read yet", deliberately different from
 * `0n`. Nothing may block on a balance we have not actually observed.
 */
export function useTokenBalances(owner: Address | undefined) {
  const query = useReadContracts({
    contracts: TOKENS.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [owner ?? "0x0000000000000000000000000000000000000000"] as const,
    })),
    query: {
      enabled: Boolean(owner),
      refetchInterval: 12_000,
    },
  });

  const balances: Record<Address, bigint | undefined> = {};
  TOKENS.forEach((token, i) => {
    const entry = query.data?.[i];
    balances[token.address] =
      entry?.status === "success" ? (entry.result as bigint) : undefined;
  });

  return {
    balances,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
