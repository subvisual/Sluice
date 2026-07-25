"use client";

import type { Address } from "viem";
import { formatAmount, parseAmount } from "@/lib/amount";
import type { TokenMeta } from "@/lib/compose/types";

export type PickerRow = { selected: boolean; input: string };

export function TokenPicker({
  tokens,
  rows,
  balances,
  balancesLoading,
  onChange,
}: {
  tokens: TokenMeta[];
  rows: Record<Address, PickerRow>;
  balances: Record<Address, bigint | undefined>;
  balancesLoading: boolean;
  onChange: (token: Address, row: PickerRow) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Budget</h2>
        <span className="text-xs text-muted">
          A ceiling you set — not your balance
        </span>
      </div>
      <p className="mb-4 text-xs text-muted">
        The composer may commit these tokens and no others, up to these amounts
        and no further. Tokens never leave your wallet.
      </p>

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {tokens.map((token) => {
          const row = rows[token.address] ?? { selected: false, input: "" };
          const balance = balances[token.address];
          const parsed = parseAmount(row.input, token.decimals);
          const malformed = row.selected && row.input.trim() !== "" && parsed === null;
          const overBalance =
            row.selected &&
            parsed !== null &&
            balance !== undefined &&
            parsed > balance;

          return (
            <div
              key={token.address}
              className={`flex items-center gap-4 px-4 py-3 transition-colors ${
                row.selected ? "bg-surface-2" : "bg-transparent"
              }`}
            >
              <label className="flex min-w-40 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={(e) =>
                    onChange(token.address, { ...row, selected: e.target.checked })
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-sm font-medium">{token.symbol}</span>
                  <span className="block text-xs text-muted">{token.name}</span>
                </span>
              </label>

              <div className="flex-1 text-xs text-muted">
                {balancesLoading && balance === undefined
                  ? "reading balance…"
                  : balance === undefined
                    ? "balance unknown"
                    : `balance ${formatAmount(balance, token.decimals)}`}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.input}
                  disabled={!row.selected}
                  placeholder="0.0"
                  onChange={(e) =>
                    onChange(token.address, { ...row, input: e.target.value })
                  }
                  className={`amount w-40 rounded-md border bg-background px-3 py-1.5 text-right text-sm outline-none disabled:opacity-40 ${
                    malformed || overBalance
                      ? "border-danger text-danger"
                      : "border-border focus:border-accent/60"
                  }`}
                />
                <button
                  disabled={!row.selected || balance === undefined}
                  onClick={() =>
                    onChange(token.address, {
                      ...row,
                      input: exactInput(balance!, token.decimals),
                    })
                  }
                  className="rounded-md border border-border px-2 py-1.5 text-xs text-muted transition-colors hover:border-muted hover:text-foreground disabled:opacity-30"
                >
                  Max
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * "Max" must round-trip exactly: the string we put in the box has to parse back
 * to the same base-units value. `formatAmount` is lossy on purpose (it trims
 * for readability), so it must not be used here.
 */
function exactInput(balance: bigint, decimals: number) {
  if (decimals === 0) return balance.toString();
  const s = balance.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const fraction = s.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
