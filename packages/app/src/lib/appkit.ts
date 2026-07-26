import { createAppKit } from "@reown/appkit/react";
import { base } from "@reown/appkit/networks";
import type { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { rpcUrlFor, type RpcMode } from "./network";
import { REOWN_PROJECT_ID } from "./wagmi";

let initialized = false;

/**
 * Idempotent — called from the Providers useState initializer, which React
 * strict mode double-invokes in dev. It MUST also run during SSR: client
 * components server-render, and useAppKit throws unless createAppKit ran in
 * the same runtime (gating this on `typeof window` 500'd every SSR pass once
 * a projectId was set). Reown's Next.js pattern is module-scope createAppKit,
 * evaluated on both sides; the server instance exists only to satisfy SSR
 * hook calls — the latch means it keeps the first request's mode, which is
 * fine because no SSR'd markup depends on AppKit's mode-specific internals.
 * Without a projectId this no-ops; the header renders a note instead of a
 * connect button (connect-button.tsx), so AppKit hooks are never reached.
 */
export function initAppKit(adapter: WagmiAdapter, mode: RpcMode): void {
  if (initialized || !REOWN_PROJECT_ID) {
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
      url:
        typeof window === "undefined"
          ? "http://localhost:3000"
          : window.location.origin,
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
