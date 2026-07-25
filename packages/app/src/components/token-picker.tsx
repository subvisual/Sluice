// No "use client" — leaf of the Compose screen's client tree (callback props).

import type { Address } from "viem";
import { formatAmount, parseAmount } from "@/lib/amount";
import type { TokenMeta } from "@/lib/compose/types";
import { TokenIcon } from "./token-icon";

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
  const derived = tokens.map((token) => {
    const row = rows[token.address] ?? { selected: false, input: "" };
    const balance = balances[token.address];
    const parsed = parseAmount(row.input, token.decimals);
    const malformed =
      row.selected && row.input.trim() !== "" && parsed === null;
    const overBalance =
      row.selected &&
      parsed !== null &&
      balance !== undefined &&
      parsed > balance;
    const problem = malformed
      ? `${token.symbol}: that is not a number we can read.`
      : overBalance
        ? `${token.symbol}: more than the wallet holds.`
        : null;
    return { token, row, balance, problem };
  });

  // The first row-level problem, echoed in prose under the list.
  const rowError = derived.find((d) => d.problem)?.problem ?? null;

  const rendered = derived.map(({ token, row, balance, problem }) => {
    const bad = problem !== null;

    return (
      <div
        key={token.address}
        className={`flex flex-wrap items-center gap-4 rounded-[10px] border px-4 py-3.5 transition-colors ${
          bad
            ? "border-danger-line bg-surface-2"
            : row.selected
              ? "border-aqua-line bg-surface-2"
              : "border-border bg-transparent"
        }`}
      >
        <label className="flex min-w-[150px] cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={row.selected}
            onChange={(e) =>
              onChange(token.address, { ...row, selected: e.target.checked })
            }
            className="h-4 w-4 cursor-pointer accent-aqua"
          />
          <span className="flex items-center gap-2.5">
            <TokenIcon address={token.address} symbol={token.symbol} size={28} />
            <span>
              <span className="block text-sm font-medium">{token.symbol}</span>
              <span className="block text-[11.5px] text-muted">
                {token.name}
              </span>
            </span>
          </span>
        </label>

        <div
          className={`min-w-[120px] flex-1 text-xs ${
            balancesLoading && balance === undefined
              ? "animate-reading text-muted-3"
              : "text-muted"
          }`}
        >
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
            className={`amount w-[170px] rounded-lg border bg-surface px-3 py-[9px] text-right font-mono text-[15px] outline-none disabled:opacity-40 ${
              bad
                ? "border-danger text-danger"
                : "border-border text-text focus:border-aqua-line"
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
            className="rounded-lg border border-border px-3 py-[9px] text-xs text-muted transition-colors hover:border-muted hover:text-text disabled:opacity-30"
          >
            Max
          </button>
        </div>
      </div>
    );
  });

  return (
    <section className="rounded-[18px] border border-glass-line bg-card p-6 shadow-[var(--shadow-sm)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-medium">Budget</h2>
        <span className="font-mono text-[10.5px] text-muted-2">
          a ceiling you set — not your balance
        </span>
      </div>
      <p className="mt-2 mb-[18px] max-w-[640px] text-[12.5px] leading-[1.6] text-muted">
        The composer may commit these tokens and no others, up to these amounts
        and no further. Tokens never leave your wallet.
      </p>

      <div className="flex flex-col gap-2.5">{rendered}</div>

      {rowError && (
        <p className="mt-3 text-xs text-danger">{rowError}</p>
      )}
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
