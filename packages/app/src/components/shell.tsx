"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { RpcMode } from "@/lib/network";
import { ConnectButton } from "./connect-button";
import { NetworkToggle } from "./network-toggle";

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
        <Rail />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="z-20 flex flex-wrap items-center justify-between gap-5 border-b border-glass-edge bg-glass-3 px-[30px] py-[15px]">
            <p className="max-w-[520px] text-[13px] leading-normal text-muted-2">
              Address SwapVM in a sentence.{" "}
              <span className="text-text">
                Your tokens never leave your wallet.
              </span>
            </p>
            <div className="ml-auto flex items-center justify-end gap-3.5">
              <NetworkToggle mode={mode} />
              <ConnectButton mode={mode} />
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

function Rail() {
  const pathname = usePathname();

  return (
    <aside className="box-border flex h-full w-[236px] min-h-0 flex-none flex-col gap-[22px] overflow-y-auto border-r border-glass-edge bg-glass-3 px-[14px] py-[22px]">
      <div className="flex items-center gap-2.5 pt-0.5 px-2">
        <Image
          src="/logo.png"
          alt="Sluice"
          width={28}
          height={28}
          priority
          className="h-7 w-7 rounded-[9px] shadow-[var(--shadow-sm)]"
        />
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

      </nav>

      <PoweredBy />
    </aside>
  );
}

/**
 * The three load-bearing integrations, credited where sponsors will look.
 * Marks are inlined and filled with `currentColor` so all three sit in the
 * same monochrome tint instead of their clashing brand palettes.
 */
const POWERED_BY = [
  { name: "1inch Aqua", href: "https://1inch.io", Mark: OneInchMark },
  { name: "0G", href: "https://0g.ai", Mark: ZeroGMark },
  { name: "The Graph", href: "https://thegraph.com", Mark: TheGraphMark },
] as const;

function PoweredBy() {
  return (
    <div className="mt-auto flex items-center gap-3 px-2">
      <span className="font-mono text-[9px] tracking-[0.12em] text-muted-3">
        POWERED BY
      </span>
      {POWERED_BY.map(({ name, href, Mark }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={name}
          className="text-muted-2 transition-colors hover:text-text"
        >
          <Mark />
          <span className="sr-only">{name}</span>
        </a>
      ))}
    </div>
  );
}

/** The 2023-rebrand 1inch tile glyph: a "1" plus the two inch marks (″). */
function OneInchMark() {
  return (
    <svg viewBox="12.9 9.6 20.9 20.8" className="h-4 w-auto" fill="currentColor" aria-hidden>
      <path d="M12.9957 30.3368H27.0039V27.3877H21.843V9.66367H18.7759C18.658 12.1409 17.9502 12.7602 14.5587 12.7602H12.9957V15.5913H18.1566V27.3877H12.9957V30.3368Z" />
      <path d="M28.4786 15.5918V9.66413H25.5295V15.5918H28.4786Z" />
      <path d="M33.665 15.5918V9.66413H30.7159V15.5918H33.665Z" />
    </svg>
  );
}

/** The 0G wordmark, from the docs-site logo with the gradient dropped. */
function ZeroGMark() {
  return (
    <svg viewBox="25 86 246 121" className="h-[13px] w-auto" fill="currentColor" aria-hidden>
      <path d="M126.817 188.82C104.397 211.239 68.4709 211.92 45.2311 190.862L64.1127 171.98L97.5114 138.582L103.791 144.861L71.8683 176.784C83.7947 182.012 98.2146 179.744 107.978 169.981C120.694 157.264 120.694 136.646 107.978 123.929C95.2608 111.212 74.6426 111.212 61.9258 123.929C50.6387 135.216 49.3697 152.728 58.1188 165.415L39.1066 184.427C20.0511 161.17 21.3776 126.798 43.0863 105.089C66.2079 81.9677 103.695 81.9677 126.817 105.089C149.938 128.211 149.938 165.698 126.817 188.82Z" />
      <path d="M211.019 204.427C242.726 204.427 268.611 179.504 270.153 148.181H196.218V157.062H241.363C236.626 169.191 224.827 177.784 211.02 177.784C193.035 177.784 178.456 163.205 178.456 145.22C178.456 127.236 193.035 112.657 211.02 112.657C226.982 112.657 240.262 124.142 243.046 139.3H269.934C266.963 109.381 241.72 86.0137 211.019 86.0137C178.321 86.0137 151.813 112.521 151.813 145.22C151.813 177.919 178.321 204.427 211.019 204.427Z" />
    </svg>
  );
}

/** The Graph's GRT glyph, without the purple roundel. */
function TheGraphMark() {
  return (
    <svg viewBox="28 22 45.2 58" className="h-4 w-auto" fill="currentColor" aria-hidden>
      <g transform="translate(-88 -52)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M135.3,106.2c-7.1,0-12.8-5.7-12.8-12.8c0-7.1,5.7-12.8,12.8-12.8c7.1,0,12.8,5.7,12.8,12.8 C148.1,100.5,142.4,106.2,135.3,106.2 M135.3,74.2c10.6,0,19.2,8.6,19.2,19.2s-8.6,19.2-19.2,19.2c-10.6,0-19.2-8.6-19.2-19.2 S124.7,74.2,135.3,74.2z M153.6,113.6c1.3,1.3,1.3,3.3,0,4.5l-12.8,12.8c-1.3,1.3-3.3,1.3-4.5,0c-1.3-1.3-1.3-3.3,0-4.5l12.8-12.8 C150.3,112.3,152.4,112.3,153.6,113.6z M161,77.4c0,1.8-1.4,3.2-3.2,3.2c-1.8,0-3.2-1.4-3.2-3.2s1.4-3.2,3.2-3.2 C159.5,74.2,161,75.6,161,77.4z"
        />
      </g>
    </svg>
  );
}

