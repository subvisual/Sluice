// No "use client" — a leaf of the dashboard's client tree; its own client entry
// would demand serializable props (it takes callbacks).

import { useEffect, useState } from "react";
import { displayFrac, formatFixed } from "@/lib/amount";
import { positionStatus, type Position } from "@/lib/book";
import { countdown, formatDayShort, formatDeadlineAbs } from "@/lib/time";
import { ProvenanceChip, StatusChip } from "./chips";
import { SlotTable } from "./slot-table";
import { PairIcons } from "./token-icon";

/**
 * Strategy detail — a right sheet over the blurred dashboard, everything about
 * one shipped strategy. No edit action anywhere: shipped strategies are
 * immutable, the only exits are dock() and expiry.
 */
export function DetailSheet({
  position,
  now,
  onClose,
  onDock,
}: {
  position: Position;
  now: number;
  onClose: () => void;
  onDock: (id: string) => void;
}) {
  // Open by default — the slot assignment is the point of this screen for
  // technical viewers.
  const [whyOpen, setWhyOpen] = useState(true);
  const [dockArmed, setDockArmed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = positionStatus(position, now);
  const live = status === "Live";

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* The blur is load-bearing — without it the dashboard text competes with
          the sheet. */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-scrim backdrop-blur-[7px] backdrop-saturate-[0.9]"
      />
      <section className="relative flex h-full w-[600px] max-w-[92vw] animate-sheet flex-col border-l border-glass-line bg-sheet backdrop-blur-[20px]">
        <header className="flex items-start justify-between gap-4 border-b border-glass-line px-[26px] py-[22px]">
          <div className="flex items-center gap-2.5">
            <PairIcons position={position} />
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-semibold tracking-[-0.02em]">
                  {position.pair}
                </h2>
                <StatusChip status={status} />
              </div>
              <div className="mt-[5px] font-mono text-[11px] text-muted">
                {position.templateLabel} · {shortHash(position.strategyHash)}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-2.5 py-[5px] text-[13px] text-muted transition-colors hover:border-muted hover:text-text"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-[26px]">
          <p className="text-base leading-relaxed text-text text-pretty">
            {position.description}
          </p>

          <div className="rounded-xl border border-border bg-surface-2 p-[18px]">
            <div className="font-mono text-[10px] tracking-[0.08em] text-muted-2">
              {bandLabel(position, live)}
            </div>
            <div className="mt-2 font-mono text-2xl tracking-[-0.01em] tabular-nums">
              {position.band}
            </div>
            <div className="mt-1.5 text-xs text-muted">{position.bandNote}</div>
          </div>

          <div>
            <SectionHead>AMOUNTS</SectionHead>
            <div className="overflow-hidden rounded-[10px] border border-border">
              <div className="grid [grid-template-columns:0.8fr_1fr_1fr_1fr] gap-3 border-b border-border bg-surface-2 px-4 py-[9px] font-mono text-[9.5px] tracking-[0.07em] text-muted-2">
                <span>TOKEN</span>
                <span className="text-right">VIRTUAL</span>
                <span className="text-right">CONSUMED</span>
                <span className="text-right">REMAINING</span>
              </div>
              {position.legs.map((leg) => {
                const frac = displayFrac(leg.decimals);
                return (
                  <div
                    key={leg.token}
                    className="grid [grid-template-columns:0.8fr_1fr_1fr_1fr] gap-3 border-b border-hairline px-4 py-[11px] font-mono text-[12.5px] tabular-nums"
                  >
                    <span className="text-muted">{leg.symbol}</span>
                    <span className="text-right">
                      {formatFixed(leg.virtual, leg.decimals, frac)}
                    </span>
                    <span className="text-right">
                      {formatFixed(leg.consumed, leg.decimals, frac)}
                    </span>
                    <span className="text-right text-muted">
                      {formatFixed(leg.virtual - leg.consumed, leg.decimals, frac)}
                    </span>
                  </div>
                );
              })}
              <div className="px-4 py-2.5 text-[11px] text-muted-3">
                Virtual amount is the ceiling you authorised — not a transfer.
              </div>
            </div>
          </div>

          <div>
            <SectionHead>FILLS</SectionHead>
            {position.fills.length === 0 ? (
              <p className="text-[12.5px] text-muted">No fills yet.</p>
            ) : (
              <div className="flex flex-col">
                {position.fills.map((fill) => (
                  <div
                    key={fill.time + fill.flow}
                    className="flex items-baseline justify-between gap-3 border-b border-hairline py-2.5"
                  >
                    <span className="font-mono text-[11.5px] text-muted">
                      {fill.time}
                    </span>
                    <span className="font-mono text-[12.5px] tabular-nums">
                      {fill.flow}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border p-[18px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2.5">
              <div>
                <div className="font-mono text-[10px] tracking-[0.08em] text-muted-2">
                  DEADLINE
                </div>
                <div className="mt-[7px] font-mono text-sm tabular-nums">
                  {position.deadline === null
                    ? "none in program"
                    : formatDeadlineAbs(position.deadline)}
                </div>
              </div>
              <DeadlineCountdown position={position} now={now} status={status} />
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted-3">
              {position.deadline === null
                ? "This program carries no DEADLINE instruction — it stays live until docked."
                : "At expiry the position unwinds automatically — no action needed from you."}
            </p>
          </div>

          <div>
            <button
              onClick={() => setWhyOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 rounded-[10px] border border-border bg-surface-2 px-4 py-3.5 text-left transition-colors hover:border-muted"
            >
              <span>
                <span className="block text-sm font-medium">Why this</span>
                <span className="mt-[3px] block text-[11.5px] text-muted">
                  Slot assignment — which instruction fills each slot
                </span>
              </span>
              <span className="font-mono text-xs text-muted">
                {whyOpen ? "−" : "+"}
              </span>
            </button>
            {whyOpen && (
              <div className="mt-3">
                <SlotTable slots={position.slots} variant="sheet" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 border-t border-border pt-5">
            <ProvenanceChip provenance={position.provenance} />
            {position.provenance === "ENCLAVE" ? (
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className="text-aqua-text">✓</span> signed by the 0G
                enclave
              </span>
            ) : position.provenance === "TEMPLATE_FALLBACK" ? (
              <span className="text-[11.5px] text-muted">
                deterministic template — not a model output
              </span>
            ) : (
              <span className="text-[11.5px] text-muted">
                shipped elsewhere, or before this browser cached it — no local
                record of how it was produced
              </span>
            )}
          </div>
        </div>

        <footer className="border-t border-glass-line px-[26px] py-[18px]">
          <div className="flex flex-wrap items-center justify-between gap-3.5">
            <p className="max-w-[340px] text-[11.5px] leading-normal text-muted-3">
              A docked strategy can never be re-shipped — only recreated from
              scratch.
            </p>
            {status !== "Docked" && (
              <button
                onClick={() =>
                  dockArmed ? onDock(position.id) : setDockArmed(true)
                }
                onBlur={() => setDockArmed(false)}
                className="rounded-[10px] border border-danger-line px-5 py-[11px] text-sm font-medium text-danger transition-colors hover:bg-danger-soft"
              >
                {dockArmed ? "Confirm dock — permanent" : "Dock position"}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 font-mono text-[10.5px] tracking-[0.09em] text-muted-2">
      {children}
    </h3>
  );
}

/** Past tense once the strategy is no longer operating. */
function bandLabel(position: Position, live: boolean) {
  const verb = live ? "OPERATES" : "OPERATED";
  return `${verb} ${position.bandKind === "band" ? "ON" : "AT"}`;
}

function DeadlineCountdown({
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
  return <span className={`font-mono text-[13px] ${color}`}>{label}</span>;
}
