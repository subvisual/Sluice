import type { Address } from "viem";
import addresses from "../../../../config/addresses.8453.json";

export const AQUA = addresses.aqua as Address;
export const SWAPVM_ROUTER = addresses.swapVMRouter as Address;

export const AQUA_ABI = [
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
  "function multicall(bytes[] data) returns (bytes[] results)",
] as const;

export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
] as const;
