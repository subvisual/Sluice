import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi } from "viem";
import { assembleShipMulticall } from "./ship";
import { AQUA_ABI, SWAPVM_ROUTER } from "./aqua";

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
