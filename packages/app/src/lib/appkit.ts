import { createAppKit } from "@reown/appkit/react";
import { base } from "@reown/appkit/networks";
import type { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { rpcUrlFor, type RpcMode } from "./network";
import { REOWN_PROJECT_ID } from "./wagmi";

let initialized = false;

/**
 * Idempotent — called from the Providers useState initializer, which React
 * strict mode double-invokes in dev. Client-only: createAppKit touches the
 * DOM, and the server only ever needs the adapter's wagmiConfig.
 * Without a projectId this no-ops; the header renders a note instead of a
 * connect button (connect-button.tsx), so AppKit hooks are never reached.
 */
export function initAppKit(adapter: WagmiAdapter, mode: RpcMode): void {
  if (initialized || !REOWN_PROJECT_ID || typeof window === "undefined") {
    return;
  }
  initialized = true;
  createAppKit({
    adapters: [adapter],
    networks: [base],
    defaultNetwork: base,
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: "Sluice",
      description: "Strategy Composer for 1inch Aqua",
      url: window.location.origin,
      icons: [],
    },
    // AppKit's own native RPC calls (balances etc.) follow the mode too —
    // otherwise local-fork state and the modal's display would disagree.
    customRpcUrls: {
      "eip155:8453": [{ url: rpcUrlFor(mode) }],
    },
    features: {
      analytics: false,
    },
  });
}
