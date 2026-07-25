import type { Address } from "viem";
import type { TokenMeta } from "./compose/types";
import addresses from "../../../../config/addresses.8453.json";

/**
 * The selectable token list.
 *
 * Read from `config/addresses.8453.json` — F1 §1 is explicit that this is ONE
 * file, shared by the Base fork and Base mainnet. Adding a token to the picker
 * is a JSON edit, not a code change. `tokenList` carries display metadata; the
 * flat `tokens` map belongs to the Forge fork test.
 */
export const TOKENS: TokenMeta[] = addresses.tokenList.map((t) => ({
  symbol: t.symbol,
  name: t.name,
  address: t.address as Address,
  decimals: t.decimals,
}));

export const CONFIG_CHAIN_ID = addresses.chainId;

export function tokenBy(address: Address): TokenMeta | undefined {
  return TOKENS.find((t) => t.address.toLowerCase() === address.toLowerCase());
}

/** Display-side lookup (pair labels carry symbols, not addresses). */
export function tokenBySymbol(symbol: string): TokenMeta | undefined {
  return TOKENS.find((t) => t.symbol === symbol);
}
