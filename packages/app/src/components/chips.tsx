import type { PositionStatus, Provenance, RiskRating } from "@/lib/book";

/*
 * Chips sit on white with colored borders and text — never tinted fills, and
 * never the bright --aqua/--warn pair for text (fails AA at this size).
 */

const STATUS: Record<PositionStatus, string> = {
  Live: "border-aqua-line text-aqua-text",
  Expired: "border-warn-line text-warn-text",
  Docked: "border-border text-muted",
};

export function StatusChip({ status }: { status: PositionStatus }) {
  return (
    <span
      className={`whitespace-nowrap rounded-full border bg-card px-[11px] py-1 font-mono text-[10px] tracking-[0.06em] shadow-[var(--shadow-sm)] ${STATUS[status]}`}
    >
      {status}
    </span>
  );
}

const RISK: Record<RiskRating, string> = {
  low: "border-aqua-line text-aqua-text",
  medium: "border-warn-line text-warn-text",
  high: "border-danger-line text-danger",
};

/** Absent rating says so in plain text — never substitute a number. */
export function RiskChip({ risk }: { risk: RiskRating | null }) {
  if (risk === null) {
    return (
      <span className="whitespace-nowrap text-[10.5px] text-muted-3">
        risk rating unavailable
      </span>
    );
  }
  return (
    <span
      className={`whitespace-nowrap rounded-md border bg-card px-[9px] py-[3px] font-mono text-[10px] tracking-[0.05em] shadow-[var(--shadow-sm)] ${RISK[risk]}`}
    >
      risk {risk}
    </span>
  );
}

/**
 * ENCLAVE gets its verification check; a template fallback is a normal,
 * honest outcome and is labelled without one.
 */
export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-aqua-line bg-card px-2.5 py-[5px] font-mono text-[10px] tracking-[0.06em] text-aqua-text">
      {provenance === "ENCLAVE" ? "✓ ENCLAVE" : "TEMPLATE_FALLBACK"}
    </span>
  );
}
