"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { displayFrac, formatFixed } from "@/lib/amount";
import {
  positionStatus,
  useBook,
  type Position,
  type PositionLeg,
} from "@/lib/book";
import { countdown, formatDayShort } from "@/lib/time";
import { DetailSheet } from "./detail-sheet";
import { RiskChip, StatusChip } from "./chips";
import { PairIcons } from "./token-icon";

/**
 * Dashboard — "what do I have live right now, and how is it doing?"
 * Everything on a card is a committed ceiling the user authorised, never a
 * balance. De-emphasis of non-live cards is a tint, never opacity (opacity
 * drags the small captions below AA).
 */
export function Dashboard() {
  const { positions, isConnected, isLoading, dock, showDemo } = useBook();
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow();

  const open = positions?.find((p) => p.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.025em]">
            Positions
          </h1>
          <p className="mt-1.5 text-[13px] text-muted">
            {summary(positions, now, isLoading, isConnected)}
          </p>
        </div>
        <Link
          href="/compose"
          className="rounded-[10px] bg-ink px-5 py-[11px] text-sm font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2"
        >
          New strategy
        </Link>
      </div>

      {positions === null ? (
        isLoading ? (
          <BookLoading />
        ) : isConnected ? (
          <BookUnavailable onDemo={showDemo} />
        ) : (
          <NoWallet onDemo={showDemo} />
        )
      ) : positions.length === 0 ? (
        <EmptyState onDemo={showDemo} />
      ) : (
        <>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
            {positions.map((p) => (
              <PositionCard
                key={p.id}
                position={p}
                now={now}
                onOpen={() => setOpenId(p.id)}
              />
            ))}
            <Link
              href="/compose"
              className="flex min-h-[220px] flex-col items-center justify-center gap-2.5 rounded-[18px] border border-dashed border-glass-line bg-glass-3 p-6 transition-colors hover:border-aqua hover:bg-card-2"
            >
              <span className="text-[22px] text-aqua-text">+</span>
              <span className="text-sm text-muted">New strategy</span>
              <span className="text-[11.5px] text-muted-3">
                a sentence and a budget
              </span>
            </Link>
          </div>
          <p className="mt-5 text-[11.5px] leading-relaxed text-muted-3">
            Committed amounts are ceilings you authorised, not balances. Risk
            ratings come from the signed recommendation; where one is absent the
            card says so rather than showing a number we don&apos;t have.
          </p>
        </>
      )}

      {open && (
        <DetailSheet
          position={open}
          now={now}
          onClose={() => setOpenId(null)}
          onDock={(id) => {
            dock(id);
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

/** Unix seconds, refreshed each minute so countdowns don't go stale. */
function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      60_000,
    );
    return () => clearInterval(timer);
  }, []);
  return now;
}

function summary(
  positions: Position[] | null,
  now: number,
  isLoading: boolean,
  isConnected: boolean,
) {
  if (positions === null) {
    if (isLoading) return "Loading your book…";
    return isConnected ? "Book unavailable" : "Connect a wallet to see your book";
  }
  if (positions.length === 0) return "Nothing live yet";
  const counts = { Live: 0, Expired: 0, Docked: 0 };
  for (const p of positions) counts[positionStatus(p, now)] += 1;
  return `${counts.Live} live · ${counts.Expired} expired · ${counts.Docked} docked — committed ceilings you authorised, not balances`;
}

/* ---------------------------------------------------------------- card */

function PositionCard({
  position,
  now,
  onOpen,
}: {
  position: Position;
  now: number;
  onOpen: () => void;
}) {
  const status = positionStatus(position, now);
  const live = status === "Live";

  return (
    <button
      onClick={onOpen}
      className={`flex flex-col gap-[18px] rounded-[18px] border p-5 text-left shadow-[var(--shadow-sm)] ${
        live ? "border-glass-line bg-card" : "border-border bg-card-2"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <PairIcons position={position} />
          <div>
            <div className="text-[17px] font-semibold tracking-[-0.01em]">
              {position.pair}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-muted">
              {position.templateLabel}
            </div>
          </div>
        </div>
        <StatusChip status={status} />
      </div>

      <div className="flex flex-col gap-3">
        {position.legs.map((leg) => (
          <Leg key={leg.token} leg={leg} live={live} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2.5 border-t border-hairline pt-3.5">
        <Countdown position={position} now={now} status={status} />
        <RiskChip risk={position.risk} />
      </div>
    </button>
  );
}

function Leg({ leg, live }: { leg: PositionLeg; live: boolean }) {
  const frac = displayFrac(leg.decimals);
  const committed = formatFixed(leg.virtual, leg.decimals, frac);
  const consumed = formatFixed(leg.consumed, leg.decimals, frac);
  const pct =
    leg.virtual > 0n ? Number((leg.consumed * 100n) / leg.virtual) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="font-mono text-[11px] tracking-[0.05em] text-muted">
          {leg.symbol}
        </span>
        <span className="font-mono text-sm tabular-nums text-text">
          {committed}
        </span>
      </div>
      <div className="mt-[7px] h-1 overflow-hidden rounded-full bg-track">
        <div
          className={`h-full rounded-full ${live ? "bg-aqua" : "bg-track-2"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 font-mono text-[10.5px] text-muted-3">
        {consumed} consumed of {committed}
      </div>
    </div>
  );
}

function Countdown({
  position,
  now,
  status,
}: {
  position: Position;
  now: number;
  status: ReturnType<typeof positionStatus>;
}) {
  const { label, tone } =
    status === "Docked"
      ? { label: `docked ${formatDayShort(position.dockedAt!)}`, tone: "muted" }
      : position.deadline === null
        ? { label: "no deadline", tone: "muted" }
        : countdown(position.deadline, now);
  const color =
    tone === "warn"
      ? "text-warn-text"
      : tone === "muted"
        ? "text-muted-3"
        : "text-muted";
  return (
    <span className={`font-mono text-[11.5px] ${color}`}>{label}</span>
  );
}

/* --------------------------------------------------------------- states */

/** First read still in flight — distinct from `BookUnavailable` so a slow
 * subgraph never flashes "unavailable" before the real answer lands. */
function BookLoading() {
  return (
    <section className="rounded-[18px] border border-glass-line bg-card-2 p-8 shadow-[var(--shadow-sm)]">
      <p className="font-mono text-[11px] tracking-[0.1em] text-muted-2">
        LOADING BOOK
      </p>
      <p className="mt-3 max-w-[560px] text-sm leading-relaxed text-muted">
        Reading your positions from the book subgraph…
      </p>
    </section>
  );
}

/**
 * The book subgraph read failed — unknown is not empty. A small card rather
 * than the board below: this is a failure the user cannot act on, and a
 * full-width pitch would read as selling instead of admitting we could not
 * read their book. "Show demo positions" must be reachable from here too:
 * `demo-book.ts`'s whole purpose is showing every screen without depending on
 * the real book.
 */
function BookUnavailable({ onDemo }: { onDemo: () => void }) {
  return (
    <section className="rounded-[18px] border border-glass-line bg-card-2 p-8 shadow-[var(--shadow-sm)]">
      <p className="font-mono text-[11px] tracking-[0.1em] text-muted-2">
        BOOK UNAVAILABLE
      </p>
      <p className="mt-3 max-w-[560px] text-sm leading-relaxed text-muted">
        Your book could not be read, so nothing is shown — an unknown book is
        not the same as an empty one. Anything you have shipped is still live
        on-chain and unwinds at its deadline as normal.
      </p>
      <button
        onClick={onDemo}
        className="mt-5 rounded-[10px] border border-glass-line bg-card-2 px-5 py-[13px] text-sm text-muted shadow-[var(--shadow-sm)] transition-colors hover:border-muted hover:text-text"
      >
        Show demo positions
      </button>
    </section>
  );
}

/**
 * The board a user lands on with nothing to show: no wallet, or a wallet whose
 * book is genuinely empty. One layout for both — it is the same moment in the
 * product, "there is nothing here, here is what this is for".
 *
 * The words are what must differ. An unread book is not an empty one, so the
 * eyebrow names which state this is and `lead` says what would change it;
 * neither variant claims the user has no positions when we have not looked.
 */
function BoardHero({
  eyebrow,
  lead,
  onDemo,
}: {
  eyebrow: string;
  lead?: string;
  onDemo: () => void;
}) {
  return (
    <section className="rounded-[20px] border border-glass-line bg-card-2 px-14 py-16 shadow-[var(--shadow)]">
      <div className="max-w-[640px]">
        <p className="font-mono text-[11px] tracking-[0.1em] text-aqua-text">
          {eyebrow}
        </p>
        <h2 className="mt-[18px] text-[34px] leading-[42px] font-semibold tracking-[-0.03em] text-pretty">
          Describe a strategy in a sentence. Ship it in one signature.
        </h2>
        <p className="mt-4 text-[15px] leading-[1.65] text-muted text-pretty">
          Sluice composes risk-rated Aqua strategies from your intent and a
          budget you already hold. Composition runs sealed in a TEE and is
          signed, so you can check where the advice came from. Your tokens
          never leave your wallet.
        </p>
        {lead && (
          <p className="mt-3.5 text-[15px] leading-[1.65] text-muted text-pretty">
            {lead}
          </p>
        )}
        <div className="mt-7 flex items-center gap-3.5">
          <Link
            href="/compose"
            className="rounded-[10px] bg-ink px-6 py-[13px] text-[15px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2"
          >
            New strategy
          </Link>
          {/* Demo affordance, kept at the team's request: seeds the session
              book with the fixture positions. */}
          <button
            onClick={onDemo}
            className="rounded-[10px] border border-glass-line bg-card-2 px-5 py-[13px] text-sm text-muted shadow-[var(--shadow-sm)] transition-colors hover:border-muted hover:text-text"
          >
            Show demo positions
          </button>
        </div>
        <p className="mt-8 text-xs leading-relaxed text-muted-3">
          A strategy is immutable once shipped — it can be docked or left to
          expire, never edited.
        </p>
      </div>
    </section>
  );
}

function EmptyState({ onDemo }: { onDemo: () => void }) {
  return <BoardHero eyebrow="NO POSITIONS YET" onDemo={onDemo} />;
}

/**
 * No wallet — so the book is unknown, not empty, and the copy says exactly
 * that. Composing is still open: a sentence and a budget need no wallet, and
 * the signature is only asked for at the ship step.
 */
function NoWallet({ onDemo }: { onDemo: () => void }) {
  return (
    <BoardHero
      eyebrow="NO WALLET CONNECTED"
      lead="Connect a wallet — top right — to see your own book. Nothing is listed until then: a book we have not read is not an empty one. You can still compose without one; a wallet is only needed to ship."
      onDemo={onDemo}
    />
  );
}
