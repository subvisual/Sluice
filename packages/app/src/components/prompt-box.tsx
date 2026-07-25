"use client";

const EXAMPLES = [
  "Earn fees on ETH/USDC while it stays rangebound this week.",
  "Sell my ETH if it reaches 4,200 — all at once, not a bit at a time.",
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
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">What do you want to do?</h2>
        <span className="text-xs text-muted">
          Passed to the composer verbatim
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Describe it in your own words…"
        className="w-full resize-none rounded-lg border border-border bg-surface-2 p-3 text-sm outline-none placeholder:text-muted focus:border-accent/60"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            onClick={() => onChange(example)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-foreground"
          >
            {example}
          </button>
        ))}
      </div>
    </section>
  );
}
