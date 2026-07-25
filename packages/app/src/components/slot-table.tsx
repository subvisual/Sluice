import type { SlotRow } from "@/lib/book";
import { SLOT_GRAMMAR } from "@/lib/compose/grammar";

/**
 * The "Why this" slot-assignment table — the proof that the model's output is
 * structured selection, never free-form bytecode. Unused optional slots render
 * "— not used" rather than being hidden.
 */
export function SlotTable({
  slots,
  variant,
}: {
  slots: SlotRow[];
  /** `sheet` = detail sheet (header + footnote); `card` = recommendation card. */
  variant: "sheet" | "card";
}) {
  const sheet = variant === "sheet";
  const cols = sheet
    ? "[grid-template-columns:24px_92px_1fr_1fr] gap-3 px-4 py-2.5"
    : "[grid-template-columns:20px_78px_1fr_1fr] gap-2.5 px-3.5 py-[9px]";

  return (
    <div className="overflow-hidden rounded-[10px] border border-border">
      {sheet && (
        <div
          className={`grid items-baseline border-b border-border bg-surface-2 font-mono text-[9.5px] tracking-[0.07em] text-muted-2 ${cols}`}
        >
          <span>#</span>
          <span>SLOT</span>
          <span>INSTRUCTION</span>
          <span>PARAMETERS</span>
        </div>
      )}
      {slots.map((slot, i) => (
        <div
          key={slot.index}
          className={`grid items-baseline ${cols} ${
            i === slots.length - 1 ? "" : "border-b border-hairline"
          }`}
        >
          <span className="font-mono text-[11px] text-muted-3">
            {slot.index}
          </span>
          <span className="text-[11.5px] text-muted">{slot.name}</span>
          <span className="font-mono text-[11.5px] text-text [overflow-wrap:anywhere]">
            {slot.instruction}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted [overflow-wrap:anywhere]">
            {slot.params}
          </span>
        </div>
      ))}
      {sheet && (
        <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-3">
          Six slots, filled by selection — never free-form bytecode. Ordering
          belongs to the compiler, not to the model.
          {SLOT_GRAMMAR.provisional &&
            " This grammar is provisional pending F1 Q2."}
        </p>
      )}
    </div>
  );
}
