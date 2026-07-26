"use client";

import { useAppKit } from "@reown/appkit/react";
import { useEffect, useRef } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { EXPECTED_CHAIN_ID } from "@/lib/compose/constants";
import {
  DEV_ACCOUNT,
  DEV_AUTOCONNECT,
  DEV_CONNECTOR_ID,
} from "@/lib/dev-wallet";
import { rpcUrlFor, type RpcMode } from "@/lib/network";
import { REOWN_PROJECT_ID } from "@/lib/wagmi";

export function ConnectButton({ mode }: { mode: RpcMode }) {
  // Every branch here turns on module constants, so the choice is fixed for the
  // life of the page and the hooks below it never reorder.
  //
  // Autoconnect wins over the modal deliberately: the demo script has already
  // decided which account this is, so offering a wallet chooser would only be a
  // way to pick the wrong one.
  if (DEV_ACCOUNT && (DEV_AUTOCONNECT || !REOWN_PROJECT_ID)) {
    return <DevConnectButton mode={mode} />;
  }
  // Degraded header, not a crash: without a projectId createAppKit never ran,
  // and useAppKit would throw — so the AppKit-using component is never mounted.
  if (!REOWN_PROJECT_ID) {
    return (
      <span className="text-xs text-muted">
        NEXT_PUBLIC_REOWN_PROJECT_ID missing — wallet connect disabled
      </span>
    );
  }
  return <AppKitConnectButton mode={mode} />;
}

/** Fork rehearsal: connect the anvil-held account, no modal. See dev-wallet.ts. */
function DevConnectButton({ mode }: { mode: RpcMode }) {
  const { address, isConnected, status } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const connector = connectors.find((c) => c.id === DEV_CONNECTOR_ID);

  // Once per mount, and never while wagmi is still restoring a connection from
  // the cookie — two connects racing would leave the header flickering between
  // the two accounts they each resolved. A user who clicks Disconnect stays
  // disconnected: the ref is what keeps this from immediately undoing them.
  const attempted = useRef(false);
  useEffect(() => {
    if (!DEV_AUTOCONNECT || attempted.current) return;
    if (!connector || isConnected || status === "reconnecting") return;
    attempted.current = true;
    connect({ connector });
  }, [connect, connector, isConnected, status]);

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
