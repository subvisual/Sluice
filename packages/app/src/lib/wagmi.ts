import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base } from "@reown/appkit/networks";
import { rpcUrlFor, type RpcMode } from "./network";
import { DEV_ACCOUNT, devWallet } from "./dev-wallet";

/**
 * Reown Cloud projectId. Public by design (NEXT_PUBLIC_). When absent, the
 * header degrades to a note instead of a connect button — initAppKit no-ops —
 * and the placeholder below keeps WagmiAdapter constructible; the modal is
 * never opened without a real id.
 */
export const REOWN_PROJECT_ID =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

/**
 * ⚠️ A Base fork reports chainId 8453, IDENTICAL to Base mainnet — same Aqua
 * addresses, same token addresses, same everything on screen (F1 §1). So the
 * chain check in this app catches a user on the wrong network; it is NOT a
 * mainnet guard and must never be described as one. What separates a rehearsal
 * from a real transaction is the anvil fork probe plus SLUICE_ALLOW_MAINNET,
 * on the side that actually signs. The RpcMode toggle only picks which URL
 * this app READS from.
 */
export function getAdapter(mode: RpcMode) {
  return new WagmiAdapter({
    networks: [base],
    projectId: REOWN_PROJECT_ID || "missing-project-id",
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [base.id]: http(rpcUrlFor(mode)),
    },
    // Rehearsal only, and only when NEXT_PUBLIC_DEV_ACCOUNT names an address
    // anvil holds — see dev-wallet.ts. AppKit keeps connectors passed here
    // alongside the ones it adds itself.
    connectors: DEV_ACCOUNT
      ? [devWallet({ address: DEV_ACCOUNT, rpcUrl: rpcUrlFor(mode) })]
      : [],
  });
}
