"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EXPECTED_CHAIN_ID } from "@/lib/compose/constants";
import type { RpcMode } from "@/lib/network";
import { ConnectButton } from "./connect-button";

/**
 * The persistent shell: one floating rounded panel on a blue "desk" gradient.
 *
 * The panel's `backdrop-filter` makes it the containing block for the
 * `position:fixed` detail sheet — intentional: the sheet is clipped by the
 * shell's radius.
 */
export function AppShell({
  children,
  mode,
}: {
  children: ReactNode;
  mode: RpcMode;
}) {
  return (
    <div
      className="box-border flex h-screen p-[26px]"
      style={{
        background:
          "linear-gradient(155deg, var(--desk-1) 0%, var(--desk-3) 45%, var(--desk-2) 100%)",
      }}
    >
      <div className="flex w-full min-w-0 overflow-hidden rounded-[26px] border border-glass-edge bg-glass shadow-[var(--shadow-lg)] backdrop-blur-[18px]">
        <Rail mode={mode} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="z-20 flex flex-wrap items-center justify-between gap-5 border-b border-glass-edge bg-glass-3 px-[30px] py-[15px]">
            <p className="max-w-[520px] text-[13px] leading-normal text-muted-2">
              Address SwapVM in a sentence.{" "}
              <span className="text-text">
                Your tokens never leave your wallet.
              </span>
            </p>
            <div className="ml-auto flex items-center justify-end gap-3.5">
              <ConnectButton />
            </div>
          </header>
          <main className="box-border min-h-0 flex-1 overflow-y-auto p-[30px]">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- rail */

const NAV_ITEM =
  "flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left text-sm";
const NAV_ACTIVE =
  "border border-glass-line bg-card font-medium text-text shadow-[var(--shadow-sm)]";
const NAV_IDLE = "border border-transparent text-muted hover:text-text";

function Rail({ mode }: { mode: RpcMode }) {
  const pathname = usePathname();

  // The fork shares Base's chainId, so the network label is derived from the
  // RPC target — chainId alone cannot tell a rehearsal from the real thing.
  const isLocal = mode === "local";
  const networkLabel = `${isLocal ? "BASE FORK" : "BASE"} · ${EXPECTED_CHAIN_ID}`;

  return (
    <aside className="box-border flex h-full w-[236px] min-h-0 flex-none flex-col gap-[22px] overflow-y-auto border-r border-glass-edge bg-glass-3 px-[14px] py-[22px]">
      <div className="flex items-center gap-2.5 pt-0.5 px-2">
        {/* Placeholder tile for the real mark. */}
        <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-aqua text-sm text-white shadow-[var(--shadow-sm)]">
          ≡
        </div>
        <span className="text-[17px] font-semibold tracking-[-0.02em] text-text">
          Sluice
        </span>
      </div>

      <nav className="flex flex-col gap-[3px]">
        <p className="mb-1 ml-2.5 text-[10px] font-semibold tracking-[0.12em] text-muted-3">
          BOOK
        </p>
        <Link
          href="/"
          className={`${NAV_ITEM} ${pathname === "/" ? NAV_ACTIVE : NAV_IDLE}`}
        >
          <span className="w-3.5 text-center text-xs">▦</span>
          <span>Dashboard</span>
        </Link>
        <Link
          href="/compose"
          className={`${NAV_ITEM} ${pathname === "/compose" ? NAV_ACTIVE : NAV_IDLE}`}
        >
          <span className="w-3.5 text-center text-xs">+</span>
          <span>New strategy</span>
        </Link>

        <p className="mt-3.5 mb-1 ml-2.5 text-[10px] font-semibold tracking-[0.12em] text-muted-3">
          AUDIT
        </p>
        {/* Reserved slots for the two out-of-scope screens — visible, not links. */}
        <SoonItem glyph="◇" label="Recommendations" />
        <SoonItem glyph="≣" label="Trace & audit" />
      </nav>

      <div className="mt-auto rounded-[14px] border border-glass-line bg-card-2 p-3.5 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-[7px] font-mono text-[10px] tracking-[0.06em] text-aqua-text">
          <span className="h-1.5 w-1.5 rounded-full bg-aqua" />
          <span>{networkLabel}</span>
        </div>
        {/* Honest state line — market/pair context (F3) is still a stub. */}
        <p className="mt-2 text-[11px] leading-normal text-muted-2">
          Market pair context is stubbed. Sealed inference is live when the
          server holds an enclave key; anything else is labelled
          TEMPLATE_FALLBACK.
        </p>
      </div>
    </aside>
  );
}

function SoonItem({ glyph, label }: { glyph: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-sm text-muted-3">
      <span className="w-3.5 text-center text-xs">{glyph}</span>
      <span>{label}</span>
      <span className="ml-auto font-mono text-[9px] tracking-[0.06em] text-muted-3">
        SOON
      </span>
    </div>
  );
}
