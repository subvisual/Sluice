"use client";

import { useEffect, useRef, useState } from "react";
import { RPC_COOKIE, type RpcMode } from "@/lib/network";

const MODES: { mode: RpcMode; label: string }[] = [
  { mode: "local", label: "LOCAL FORK" },
  { mode: "mainnet", label: "BASE MAINNET" },
];

/** Client-only: persist the mode and reload into the rebuilt config. */
function applyMode(next: RpcMode) {
  document.cookie = `${RPC_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/**
 * Read-path selector between the local anvil fork and Base mainnet — both
 * chainId 8453, so this is NOT a mainnet guard (see lib/wagmi.ts). Switching
 * writes the cookie and reloads: the wagmi/AppKit config is built once per
 * page load, and rebuilding it live is a known source of stale-client bugs.
 */
export function NetworkToggle({ mode }: { mode: RpcMode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const setMode = (next: RpcMode) => {
    setOpen(false);
    if (next === mode) return;
    applyMode(next);
  };

  const current = MODES.find((m) => m.mode === mode) ?? MODES[0];

  return (
    <div className="flex items-center gap-2.5">
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title="Which venue the app reads from. Both are chainId 8453 — your wallet signs via its own RPC; to rehearse against the fork, point the wallet's Base network at the local anvil URL."
          className="flex items-center gap-2 rounded-[9px] border border-glass-line bg-card-2 px-2.5 py-[7px] font-mono text-[10px] tracking-[0.06em] text-text shadow-[var(--shadow-sm)] transition-colors hover:bg-card"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-aqua" />
          <span>{current.label}</span>
          <span
            className={`text-[8px] text-muted-3 transition-transform ${open ? "rotate-180" : ""}`}
          >
            ▾
          </span>
        </button>
        {open && (
          <ul
            role="listbox"
            aria-label="RPC network"
            className="absolute right-0 top-full z-30 mt-1.5 min-w-full overflow-hidden rounded-[10px] border border-glass-line bg-card p-1 shadow-[var(--shadow)]"
          >
            {MODES.map(({ mode: m, label }) => (
              <li key={m} role="option" aria-selected={m === mode}>
                <button
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex w-full items-center gap-2 whitespace-nowrap rounded-[7px] px-2.5 py-[7px] text-left font-mono text-[10px] tracking-[0.06em] transition-colors ${
                    m === mode
                      ? "bg-card-2 text-text"
                      : "text-muted hover:bg-card-2 hover:text-text"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${m === mode ? "bg-aqua" : "bg-transparent shadow-[inset_0_0_0_1px_var(--border)]"}`}
                  />
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
