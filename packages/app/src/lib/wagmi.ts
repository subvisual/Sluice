import { cookieStorage, createConfig, createStorage, http } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Points at the venue: an anvil fork of Base at a pinned block by default.
 * Override with NEXT_PUBLIC_RPC_URL to talk to Base mainnet (step 2).
 */
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";

/**
 * ⚠️ A Base fork reports chainId 8453, IDENTICAL to Base mainnet — same Aqua
 * addresses, same token addresses, same everything on screen (F1 §1). So the
 * chain check in this app catches a user on the wrong network; it is NOT a
 * mainnet guard and must never be described as one. What separates a rehearsal
 * from a real transaction is the anvil fork probe plus SLUICE_ALLOW_MAINNET,
 * on the side that actually signs.
 */
export function getConfig() {
  return createConfig({
    chains: [base],
    connectors: [injected()],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    transports: {
      [base.id]: http(RPC_URL),
    },
  });
}
