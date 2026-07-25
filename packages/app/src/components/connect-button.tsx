"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { EXPECTED_CHAIN_ID } from "@/lib/compose/constants";
import { RPC_URL } from "@/lib/wagmi";

export function ConnectButton() {
  const { address, chainId, isConnected, isConnecting, isReconnecting } =
    useAccount();
  const { connect, connectors, isPending, error } = useConnect();
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
        <div className="text-right">
          <div className="font-mono text-[13px] text-text">{short(address)}</div>
          <div className="text-[10px] text-muted-3">{RPC_URL}</div>
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

  const busy = isConnecting || isReconnecting || isPending;

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="max-w-64 truncate text-xs text-danger">
          {error.message}
        </span>
      )}
      {connectors.length === 0 && (
        <span className="text-xs text-muted">No wallet detected</span>
      )}
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          disabled={busy}
          onClick={() => connect({ connector })}
          className="rounded-[10px] bg-ink px-[18px] py-2.5 text-[13px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--border)]"
        >
          {busy ? "Connecting…" : `Connect ${connector.name}`}
        </button>
      ))}
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
