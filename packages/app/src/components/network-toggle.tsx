"use client";

import { RPC_COOKIE, type RpcMode } from "@/lib/network";

const SEGMENT =
  "rounded-[7px] px-2.5 py-[5px] font-mono text-[10px] tracking-[0.06em] transition-colors";

/**
 * Read-path selector between the local anvil fork and Base mainnet — both
 * chainId 8453, so this is NOT a mainnet guard (see lib/wagmi.ts). Switching
 * writes the cookie and reloads: the wagmi/AppKit config is built once per
 * page load, and rebuilding it live is a known source of stale-client bugs.
 */
export function NetworkToggle({ mode }: { mode: RpcMode }) {
  const setMode = (next: RpcMode) => {
    if (next === mode) return;
    document.cookie = `${RPC_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  };

  return (
    <div className="flex items-center gap-2.5">
      {mode === "local" && (
        <span className="hidden max-w-72 text-right text-[10px] leading-tight text-muted-3 xl:block">
          Rehearsal: point your wallet&apos;s Base RPC at the fork — extension
          wallets only, mobile can&apos;t reach 127.0.0.1.
        </span>
      )}
      <div
        className="flex items-center gap-0.5 rounded-[9px] border border-glass-line bg-card-2 p-0.5 shadow-[var(--shadow-sm)]"
        role="group"
        aria-label="RPC network"
        title="Which venue the app reads from. Both are chainId 8453 — your wallet signs via its own RPC; to rehearse against the fork, point the wallet's Base network at the local anvil URL."
      >
        <button
          onClick={() => setMode("local")}
          aria-pressed={mode === "local"}
          className={`${SEGMENT} ${
            mode === "local"
              ? "bg-ink text-white shadow-[var(--shadow-sm)]"
              : "text-muted hover:text-text"
          }`}
        >
          LOCAL FORK
        </button>
        <button
          onClick={() => setMode("mainnet")}
          aria-pressed={mode === "mainnet"}
          className={`${SEGMENT} ${
            mode === "mainnet"
              ? "bg-ink text-white shadow-[var(--shadow-sm)]"
              : "text-muted hover:text-text"
          }`}
        >
          BASE MAINNET
        </button>
      </div>
    </div>
  );
}
