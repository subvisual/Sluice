// No "use client" — leaf of the Compose screen's client tree (callback props).

// Each seeds an intent one of the four templates serves. (An earlier example
// promised an oracle-triggered all-at-once sale — an intent with no opcode on
// the deployed router; do not reintroduce it.)
const EXAMPLES = [
  "Earn fees on ETH/USDC while it stays rangebound this week.",
  "Quote deep around the current price — I don't expect ETH to move much.",
  "I want exposure to ETH but I'm not confident about the range.",
];

export function PromptBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-[18px] border border-glass-line bg-card p-6 shadow-[var(--shadow-sm)]">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium">What do you want to do?</h2>
        <span className="font-mono text-[10.5px] text-muted-2">
          passed to the composer verbatim
        </span>
      </div>

      {/* Deliberately larger than body text — this is the hero input. */}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Describe it in your own words…"
        className="w-full resize-none rounded-[10px] border border-border bg-surface-2 p-4 text-[17px] leading-[1.55] text-text outline-none focus:border-aqua-line"
      />

      <div className="mt-3.5 flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            onClick={() => onChange(example)}
            className="rounded-full border border-border px-[13px] py-1.5 text-left text-xs text-muted transition-colors hover:border-aqua-line hover:text-text"
          >
            {example}
          </button>
        ))}
      </div>
    </section>
  );
}
