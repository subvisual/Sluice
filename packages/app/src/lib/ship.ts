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
import { EXPECTED_CHAIN_ID } from "./compose/constants";
import type { ParsedShipInput } from "./compose/from-server";

const aquaAbi = parseAbi(AQUA_ABI);
const erc20Abi = parseAbi(ERC20_ABI);

export class ForkGuardError extends Error {}

// One ship() call per input, wrapped in the Aqua contract's own multicall so
// msg.sender stays the maker (Multicall3 would not).
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

// Fork guard on the side that signs. anvil_nodeInfo answers on a fork and
// errors on real Base; only an explicit opt-in lets a non-fork through.
async function assertVenue(publicClient: PublicClient): Promise<void> {
  try {
    // anvil_nodeInfo is an anvil-only RPC method, absent from viem's EIP1193
    // union — the cast is unavoidable, not a type-safety shortcut.
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

/**
 * One entry per wallet call the ship needs, in order. Aqua pulls the real ERC20
 * from the maker only at fill time, so an approval is not what makes `ship()`
 * succeed — it is what makes the shipped position fillable. It still has to be
 * signed, so it is part of the plan and part of the count the screen promises.
 */
export type ShipCall = {
  to: Address;
  data: Hex;
  /** Human-facing, for the pre-signature summary. */
  label: string;
};

export type ShipPlan = {
  calls: ShipCall[];
  /** Tokens whose allowance to Aqua does not cover this set yet. */
  approvals: Address[];
  /** Whether those calls go out as one atomic EIP-5792 batch. */
  atomic: boolean;
  /** How many times the user will be asked to sign. */
  signatures: number;
};

/**
 * What signing this set will cost, read from chain state. The ship itself is
 * always ONE call (Aqua's own multicall wraps every selected strategy), so the
 * only thing that can make this more than one transaction is a missing ERC20
 * approval — and even that collapses into one signature on a wallet that
 * speaks EIP-5792. Pass the wallet client to have that asked; without it the
 * plan reports the pessimistic (unbatched) count.
 */
export async function planShip(args: {
  inputs: ParsedShipInput[];
  account: Address;
  publicClient: PublicClient;
  walletClient?: WalletClient;
}): Promise<ShipPlan> {
  const { inputs, account, publicClient, walletClient } = args;
  const approvals: Address[] = [];
  for (const [token, needed] of totalsByToken(inputs)) {
    const current = (await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, AQUA],
    })) as bigint;
    if (current < needed) approvals.push(token);
  }
  const calls: ShipCall[] = [
    ...approvals.map((token) => ({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [AQUA, maxUint256],
      }),
      label: "approve",
    })),
    { to: AQUA, data: assembleShipMulticall(inputs), label: "ship" },
  ];
  const atomic =
    calls.length > 1 && Boolean(walletClient) &&
    (await supportsAtomicBatch(walletClient!, account));
  return {
    approvals,
    calls,
    atomic,
    signatures: atomic ? 1 : calls.length,
  };
}

/**
 * Does this wallet execute a batch as one atomic transaction (EIP-5792)? Asked
 * BEFORE sending rather than by catching a failure: a `sendCalls` that throws
 * is ambiguous — "wallet does not support this" and "the user rejected it" look
 * alike, and falling back on a rejection would prompt someone twice for
 * something they just declined.
 */
async function supportsAtomicBatch(
  walletClient: WalletClient,
  account: Address,
): Promise<boolean> {
  try {
    const caps = await walletClient.getCapabilities({
      account,
      chainId: EXPECTED_CHAIN_ID,
    });
    const status = caps?.atomic?.status;
    return status === "supported" || status === "ready";
  } catch {
    return false; // no wallet_getCapabilities — a plain EOA wallet
  }
}

export type ShipResult = {
  strategyHashes: Hex[];
  /** How many transactions the user actually signed. */
  signatures: number;
  /** True when approve + ship went out as one atomic EIP-5792 batch. */
  atomic: boolean;
};

/**
 * Ship the selected strategies. One signature whenever the wallet allows it:
 * every selected strategy is already one `Multicall`, and a missing approval is
 * folded into the same batch on an EIP-5792 wallet. On a plain EOA wallet that
 * cannot batch, the approval is a separate signature that precedes the ship —
 * `planShip` says so before anything is sent, so the count is never a surprise.
 */
export async function shipStrategies(args: {
  inputs: ParsedShipInput[];
  account: Address;
  walletClient: WalletClient;
  publicClient: PublicClient;
}): Promise<ShipResult> {
  const { inputs, account, walletClient, publicClient } = args;
  await assertVenue(publicClient);

  const { calls, approvals, atomic } = await planShip({
    inputs,
    account,
    publicClient,
    walletClient,
  });
  const strategyHashes = inputs.map((s) => s.strategyHash);

  if (atomic) {
    const { id } = await walletClient.sendCalls({
      account,
      forceAtomic: true,
      calls: calls.map(({ to, data }) => ({ to, data })),
    });
    const result = await walletClient.waitForCallsStatus({ id });
    if (result.status !== "success") {
      throw new Error(`batched ship did not succeed (status ${result.status})`);
    }
    return { strategyHashes, signatures: 1, atomic: true };
  }

  for (const token of approvals) {
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

  const ship = calls[calls.length - 1];
  const hash = await walletClient.sendTransaction({
    account,
    chain: null,
    to: ship.to,
    data: ship.data,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { strategyHashes, signatures: calls.length, atomic: false };
}
