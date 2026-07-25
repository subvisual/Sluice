"use client";

import {
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
} from "wagmi";
import { EXPECTED_CHAIN_ID } from "@/lib/compose/constants";
import { RPC_URL } from "@/lib/wagmi";

export function ConnectButton() {
  const { address, chainId, isConnected, isConnecting, isReconnecting } =
    useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  if (isConnected && address) {
    const wrongChain = chainId !== EXPECTED_CHAIN_ID;
    return (
      <div className="flex items-center gap-3">
        {wrongChain && (
          <span className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
            chain {chainId} — expected {EXPECTED_CHAIN_ID}
          </span>
        )}
        <div className="text-right">
          <div className="font-mono text-sm">{short(address)}</div>
          <div className="text-[11px] text-muted">{RPC_URL}</div>
        </div>
        <button
          onClick={() => disconnect.mutate({})}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:border-muted hover:text-foreground"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const busy = isConnecting || isReconnecting || connect.isPending;

  return (
    <div className="flex items-center gap-2">
      {connect.error && (
        <span className="max-w-64 truncate text-xs text-danger">
          {connect.error.message}
        </span>
      )}
      {connectors.length === 0 && (
        <span className="text-xs text-muted">No wallet detected</span>
      )}
      {connectors.map((connector) => (
        <button
          key={connector.uid}
          disabled={busy}
          onClick={() => connect.mutate({ connector })}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Connecting…" : `Connect ${connector.name}`}
        </button>
      ))}
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
