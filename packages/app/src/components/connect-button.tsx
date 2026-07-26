"use client";

import { useAppKit } from "@reown/appkit/react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { EXPECTED_CHAIN_ID } from "@/lib/compose/constants";
import { DEV_ACCOUNT, DEV_CONNECTOR_ID } from "@/lib/dev-wallet";
import { rpcUrlFor, type RpcMode } from "@/lib/network";
import { REOWN_PROJECT_ID } from "@/lib/wagmi";

export function ConnectButton({ mode }: { mode: RpcMode }) {
  // Degraded header, not a crash: without a projectId createAppKit never ran,
  // and useAppKit would throw — so the AppKit-using component is never mounted.
  // The rehearsal connector does not need AppKit at all, so it still works.
  if (!REOWN_PROJECT_ID) {
    return DEV_ACCOUNT ? (
      <DevConnectButton mode={mode} />
    ) : (
      <span className="text-xs text-muted">
        NEXT_PUBLIC_REOWN_PROJECT_ID missing — wallet connect disabled
      </span>
    );
  }
  return <AppKitConnectButton mode={mode} />;
}

/** Fork rehearsal: connect the anvil-held account, no modal. See dev-wallet.ts. */
function DevConnectButton({ mode }: { mode: RpcMode }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const connector = connectors.find((c) => c.id === DEV_CONNECTOR_ID);

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2.5">
        <span className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted">
          fork account
        </span>
        <div className="text-right">
          <div className="font-mono text-[13px] text-text">{short(address)}</div>
          <div className="text-[10px] text-muted-3">{rpcUrlFor(mode)}</div>
        </div>
        <button
          onClick={() => disconnect()}
          className="rounded-[9px] border border-glass-line bg-card-2 px-[13px] py-[7px] text-[13px] text-muted shadow-[var(--shadow-sm)] transition-colors hover:text-text"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      disabled={!connector || isPending}
      onClick={() => connector && connect({ connector })}
      className="rounded-[10px] bg-ink px-[18px] py-2.5 text-[13px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
    >
      {isPending ? "Connecting…" : "Connect fork account"}
    </button>
  );
}

function AppKitConnectButton({ mode }: { mode: RpcMode }) {
  const { open } = useAppKit();
  const { address, chainId, isConnected, isConnecting, isReconnecting } =
    useAccount();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    const wrongChain = chainId !== EXPECTED_CHAIN_ID;
    return (
      <div className="flex items-center gap-2.5">
        {wrongChain && (
          <span className="rounded-md border border-danger-line bg-danger-soft px-2 py-1 text-xs text-danger">
            chain {chainId} — expected {EXPECTED_CHAIN_ID}
          </span>
        )}
        <button
          onClick={() => open({ view: "Account" })}
          className="text-right"
          title="Wallet details"
        >
          <div className="font-mono text-[13px] text-text">{short(address)}</div>
          <div className="text-[10px] text-muted-3">{rpcUrlFor(mode)}</div>
        </button>
        <button
          onClick={() => disconnect()}
          className="rounded-[9px] border border-glass-line bg-card-2 px-[13px] py-[7px] text-[13px] text-muted shadow-[var(--shadow-sm)] transition-colors hover:text-text"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const busy = isConnecting || isReconnecting;

  return (
    <button
      disabled={busy}
      onClick={() => open()}
      className="rounded-[10px] bg-ink px-[18px] py-2.5 text-[13px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--border)]"
    >
      {busy ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
