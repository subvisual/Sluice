/**
 * The runtime RPC mode: which venue the app READS from. Both modes are
 * chainId 8453 — the fork shares Base's chainId — so this is a read-path
 * selector, NOT a mainnet guard. Signing safety lives with the anvil fork
 * probe + SLUICE_ALLOW_MAINNET on the side that signs.
 *
 * Stored in a cookie (not localStorage) because the server needs it too:
 * layout.tsx builds the wagmi config for cookieToInitialState and the rail's
 * network label is SSR'd — both sides must resolve the same mode.
 */
export type RpcMode = "local" | "mainnet";

export const RPC_COOKIE = "sluice-rpc";

export const LOCAL_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";

export const MAINNET_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org";

/** Missing or unrecognised cookie ⇒ "local" — the safe rehearsal default. */
export function parseRpcMode(
  cookieHeader: string | null | undefined,
): RpcMode {
  const match = cookieHeader?.match(
    new RegExp(`(?:^|;\\s*)${RPC_COOKIE}=([^;]*)`),
  );
  return match?.[1] === "mainnet" ? "mainnet" : "local";
}

export function rpcUrlFor(mode: RpcMode): string {
  return mode === "mainnet" ? MAINNET_RPC_URL : LOCAL_RPC_URL;
}
