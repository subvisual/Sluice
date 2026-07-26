import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, maxUint256, parseAbi, type PublicClient } from "viem";
import { assembleShipMulticall, planShip } from "./ship";
import { AQUA, AQUA_ABI, SWAPVM_ROUTER } from "./aqua";

const abi = parseAbi(AQUA_ABI);
const input = {
  strategyHash: ("0x" + "aa".repeat(32)) as `0x${string}`,
  strategy: "0x1234" as `0x${string}`,
  tokens: ["0x4200000000000000000000000000000000000006"] as `0x${string}`[],
  amounts: [1000n],
};

test("assembleShipMulticall wraps one ship() call per input", () => {
  const inner = encodeFunctionData({
    abi,
    functionName: "ship",
    args: [SWAPVM_ROUTER, input.strategy, input.tokens, input.amounts],
  });
  const expected = encodeFunctionData({
    abi,
    functionName: "multicall",
    args: [[inner]],
  });
  assert.equal(assembleShipMulticall([input]), expected);
});

test("assembleShipMulticall wraps one ship() call per input, in order", () => {
  const second = {
    strategyHash: ("0x" + "bb".repeat(32)) as `0x${string}`,
    strategy: "0x5678" as `0x${string}`,
    tokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"] as `0x${string}`[],
    amounts: [2000n],
  };
  const inner1 = encodeFunctionData({
    abi,
    functionName: "ship",
    args: [SWAPVM_ROUTER, input.strategy, input.tokens, input.amounts],
  });
  const inner2 = encodeFunctionData({
    abi,
    functionName: "ship",
    args: [SWAPVM_ROUTER, second.strategy, second.tokens, second.amounts],
  });
  const expected = encodeFunctionData({
    abi,
    functionName: "multicall",
    args: [[inner1, inner2]],
  });
  assert.equal(assembleShipMulticall([input, second]), expected);
});

test("assembleShipMulticall refuses an empty set", () => {
  assert.throws(() => assembleShipMulticall([]));
});

/* ------------------------------------------------------------------ plan */

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;

/** A public client that answers `allowance` from a per-token table. */
function clientWithAllowances(
  allowances: Record<string, bigint>,
): PublicClient {
  return {
    readContract: async ({ address }: { address: string }) =>
      allowances[address] ?? 0n,
  } as unknown as PublicClient;
}

const twoTokenInput = {
  strategyHash: ("0x" + "cc".repeat(32)) as `0x${string}`,
  strategy: "0xbeef" as `0x${string}`,
  tokens: [input.tokens[0], USDC] as `0x${string}`[],
  amounts: [1000n, 2000n],
};

test("planShip: an approved token needs no approval — one signature", async () => {
  const plan = await planShip({
    inputs: [input],
    account: ACCOUNT,
    publicClient: clientWithAllowances({ [input.tokens[0]]: maxUint256 }),
  });
  assert.deepEqual(plan.approvals, []);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0].to, AQUA);
  assert.equal(plan.signatures, 1);
  assert.equal(plan.atomic, false);
});

test("planShip: every under-approved token is one more signature", async () => {
  const plan = await planShip({
    inputs: [twoTokenInput],
    account: ACCOUNT,
    // Enough WETH allowance, none for USDC.
    publicClient: clientWithAllowances({ [twoTokenInput.tokens[0]]: 5000n }),
  });
  assert.deepEqual(plan.approvals, [USDC]);
  // approve(USDC) then the ship — no wallet client, so no batching claim.
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.calls.at(-1)!.to, AQUA);
  assert.equal(plan.signatures, 2);
});

test("planShip: allowance must cover the whole selection, not one leg", async () => {
  const plan = await planShip({
    inputs: [input, { ...input, strategyHash: ("0x" + "dd".repeat(32)) as `0x${string}` }],
    account: ACCOUNT,
    // 1500 covers either strategy alone, but the two draw 2000 together.
    publicClient: clientWithAllowances({ [input.tokens[0]]: 1500n }),
  });
  assert.deepEqual(plan.approvals, [input.tokens[0]]);
  assert.equal(plan.signatures, 2);
});
