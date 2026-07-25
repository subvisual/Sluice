import {
  encodeFunctionData,
  parseAbi,
  maxUint256,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from "viem";
import { AQUA, SWAPVM_ROUTER, AQUA_ABI, ERC20_ABI } from "./aqua";
import type { ParsedShipInput } from "./compose/from-server";

const aquaAbi = parseAbi(AQUA_ABI);
const erc20Abi = parseAbi(ERC20_ABI);

export class ForkGuardError extends Error {}

// One ship() call per input, wrapped in the Aqua contract's own multicall so
// msg.sender stays the maker (Multicall3 would not — F1 §2).
export function assembleShipMulticall(inputs: ParsedShipInput[]): Hex {
  if (inputs.length === 0) throw new Error("ship: nothing to ship");
  const calls = inputs.map((s) =>
    encodeFunctionData({
      abi: aquaAbi,
      functionName: "ship",
      args: [SWAPVM_ROUTER, s.strategy, s.tokens, s.amounts],
    }),
  );
  return encodeFunctionData({
    abi: aquaAbi,
    functionName: "multicall",
    args: [calls],
  });
}

// Wiring §0, on the side that signs. anvil_nodeInfo answers on a fork and
// errors on real Base; only an explicit opt-in lets a non-fork through.
async function assertVenue(publicClient: PublicClient): Promise<void> {
  try {
    // anvil_nodeInfo is an anvil-only RPC method, absent from viem's EIP1193
    // method union — the cast is unavoidable, not a type-safety shortcut.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await publicClient.request({ method: "anvil_nodeInfo" } as any);
    return; // fork — proceed
  } catch {
    if (process.env.NEXT_PUBLIC_ALLOW_MAINNET === "1") return;
    throw new ForkGuardError(
      "not a fork and NEXT_PUBLIC_ALLOW_MAINNET is not set — refusing to sign",
    );
  }
}

// Per-token required total across the set.
function totalsByToken(inputs: ParsedShipInput[]): Map<Address, bigint> {
  const m = new Map<Address, bigint>();
  for (const s of inputs)
    s.tokens.forEach((t, i) => m.set(t, (m.get(t) ?? 0n) + s.amounts[i]));
  return m;
}

export async function shipRecommendation(args: {
  inputs: ParsedShipInput[];
  account: Address;
  walletClient: WalletClient;
  publicClient: PublicClient;
}): Promise<{ strategyHashes: Hex[] }> {
  const { inputs, account, walletClient, publicClient } = args;
  await assertVenue(publicClient);

  // Approvals (separate txs — ERC20, not batchable into Aqua's multicall).
  for (const [token, needed] of totalsByToken(inputs)) {
    const current = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, AQUA],
    })) as bigint;
    if (current < needed) {
      const hash = await walletClient.writeContract({
        account,
        chain: null,
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [AQUA, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    to: AQUA,
    data: assembleShipMulticall(inputs),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { strategyHashes: inputs.map((s) => s.strategyHash) };
}
