import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base } from "@reown/appkit/networks";
import { rpcUrlFor, type RpcMode } from "./network";
import { DEV_ACCOUNT, devWallet } from "./dev-wallet";

/**
 * Reown Cloud projectId, public by design (NEXT_PUBLIC_). When absent,
 * initAppKit no-ops and the header shows a note instead of a connect button;
 * the placeholder below keeps WagmiAdapter constructible and the modal never
 * opens without a real id.
 */
export const REOWN_PROJECT_ID =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

/**
 * ⚠️ A Base fork reports chainId 8453, IDENTICAL to Base mainnet — same Aqua
 * addresses, same tokens, same everything on screen. So this app's chain check
 * catches a user on the wrong network; it is NOT a mainnet guard. What
 * separates a rehearsal from a real transaction is the anvil fork probe plus
 * SLUICE_ALLOW_MAINNET, on the side that actually signs. The RpcMode toggle
 * only picks which URL this app READS from.
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
