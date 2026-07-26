import { createConnector } from "wagmi";
import { getAddress, type Address } from "viem";
import { EXPECTED_CHAIN_ID } from "./compose/constants";

/**
 * A rehearsal wallet for the local anvil fork — NOT a wallet.
 *
 * Signing goes straight to the fork's `eth_sendTransaction`, which anvil
 * executes with its own unlocked key. There is no prompt, no private key in the
 * browser, and no signature this connector could produce off-fork: point it at
 * anything but anvil and every send fails, because no other node will sign for
 * an address it does not hold. That is the safety property — it degrades to
 * useless rather than to dangerous.
 *
 * It exists because the ship path is the thing worth testing and a browser
 * wallet extension is not available in a headless run. Enabled only by
 * `NEXT_PUBLIC_DEV_ACCOUNT`; absent, none of this is constructed.
 */
export const DEV_ACCOUNT: Address | null = (() => {
  const raw = process.env.NEXT_PUBLIC_DEV_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
})();

export const DEV_CONNECTOR_ID = "sluice-dev-fork";

/**
 * Connect that account on page load instead of waiting for a click, and show it
 * in the header even when a Reown projectId would otherwise put the wallet modal
 * there. For `scripts/demo-up.sh`, where the wallet is a given and the demo
 * starts at the sentence — never for anything a real wallet touches, which is
 * why it is a second, explicit variable rather than a consequence of the first.
 */
export const DEV_AUTOCONNECT =
  DEV_ACCOUNT !== null &&
  ["1", "true"].includes(
    process.env.NEXT_PUBLIC_DEV_AUTOCONNECT?.trim().toLowerCase() ?? "",
  );

export function devWallet(params: { address: Address; rpcUrl: string }) {
  const { address, rpcUrl } = params;

  let id = 0;
  const provider = {
    async request({ method, params }: { method: string; params?: unknown }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return [address];
      }
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++id,
          method,
          params: params ?? [],
        }),
      });
      const body = await res.json();
      if (body.error) {
        throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
      }
      return body.result;
    },
  };

  return createConnector(() => ({
    id: DEV_CONNECTOR_ID,
    name: "Local fork account",
    type: "sluice-dev" as const,
    async connect({ withCapabilities } = {}) {
      // `withCapabilities` widens the account shape; the cast mirrors how
      // wagmi's own mock connector satisfies that conditional return type.
      return {
        accounts: (withCapabilities
          ? [{ address, capabilities: {} }]
          : [address]) as never,
        chainId: EXPECTED_CHAIN_ID,
      };
    },
    async disconnect() {},
    async getAccounts() {
      return [address] as readonly Address[];
    },
    async getChainId() {
      return EXPECTED_CHAIN_ID;
    },
    async getProvider() {
      return provider;
    },
    async isAuthorized() {
      return true;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}
