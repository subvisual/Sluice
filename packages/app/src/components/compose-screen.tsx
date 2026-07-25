"use client";

import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { parseAmount } from "@/lib/amount";
import { EXPECTED_CHAIN_ID, REQUEST_DEFAULTS } from "@/lib/compose/constants";
import { buildComposePrompt } from "@/lib/compose/prompt";
import { buildRecommendationRequest } from "@/lib/compose/request";
import type { TokenSelection } from "@/lib/compose/types";
import { TOKENS } from "@/lib/tokens";
import { useTokenBalances } from "@/lib/use-token-balances";
import { ConnectButton } from "./connect-button";
import { PromptBox } from "./prompt-box";
import { RequestPreview } from "./request-preview";
import { TokenPicker, type PickerRow } from "./token-picker";

/**
 * Compose — Wiring §6, screen 1 of 4.
 *
 * Track B item 2: the app shell against a STUBBED composer. It builds the
 * request envelope and assembles the prompt, and stops there. Nothing is sent,
 * nothing is signed, nothing touches a chain.
 */
export function ComposeScreen() {
  const { address, chainId, isConnected } = useConnection();
  const { balances, isLoading: balancesLoading } = useTokenBalances(address);

  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState<Record<Address, PickerRow>>({});
  const [revealed, setRevealed] = useState(false);

  const selections: TokenSelection[] = useMemo(
    () =>
      TOKENS.filter((t) => rows[t.address]?.selected).map((t) => ({
        token: t.address,
        amount: parseAmount(rows[t.address]?.input ?? "", t.decimals) ?? 0n,
      })),
    [rows],
  );

  const built = useMemo(
    () =>
      buildRecommendationRequest({
        user: address,
        chainId,
        expectedChainId: EXPECTED_CHAIN_ID,
        prompt,
        selections,
        balances,
        tokens: TOKENS,
      }),
    [address, chainId, prompt, selections, balances],
  );

  // `nonceOf[user] + 1` (I13). RecommendationRegistry is not deployed yet, so
  // this is a stand-in and is labelled as one in the preview rather than
  // quietly presented as a real read.
  const nonce = 1;

  const composed = useMemo(
    () =>
      built.ok
        ? buildComposePrompt({
            request: built.request,
            tokens: TOKENS,
            nonce,
            // F3 is not wired. Passing null makes the prompt say so explicitly
            // instead of inventing depth and volatility numbers.
            context: null,
          })
        : null,
    [built],
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sluice</h1>
          <p className="mt-1 text-sm text-muted">
            Address SwapVM in a sentence. Your tokens never leave your wallet.
          </p>
        </div>
        <ConnectButton />
      </header>

      <div className="space-y-5">
        <PromptBox value={prompt} onChange={setPrompt} />

        <TokenPicker
          tokens={TOKENS}
          rows={rows}
          balances={balances}
          balancesLoading={balancesLoading && isConnected}
          onChange={(token, row) =>
            setRows((prev) => ({ ...prev, [token]: row }))
          }
        />

        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-muted">
              <span className="mr-4">
                maxStrategies{" "}
                <span className="font-mono text-foreground">
                  {REQUEST_DEFAULTS.maxStrategies}
                </span>
              </span>
              <span className="mr-4">
                maxDeadline{" "}
                <span className="font-mono text-foreground">
                  {REQUEST_DEFAULTS.maxDeadlineSec / 86400}d
                </span>
              </span>
              <span>
                retries{" "}
                <span className="font-mono text-foreground">
                  {REQUEST_DEFAULTS.maxInferenceRetries}
                </span>
              </span>
            </div>

            <button
              disabled={!built.ok}
              onClick={() => setRevealed(true)}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Build request
            </button>
          </div>

          {!built.ok && built.issues.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-border pt-4">
              {built.issues.map((issue) => (
                <li key={issue.code + issue.message} className="text-xs text-muted">
                  <span className="mr-2 font-mono text-[10px] text-muted/70">
                    {issue.code}
                  </span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        {revealed && built.ok && composed && (
          <RequestPreview
            request={built.request}
            prompt={composed}
            nonce={nonce}
          />
        )}
      </div>

      <footer className="mt-10 border-t border-border pt-5 text-xs leading-relaxed text-muted">
        Not wired yet: sealed inference (F2), the deterministic gate I1–I14, market
        context and the user&apos;s book (F3), and both transactions. This screen
        stops at the assembled prompt.
      </footer>
    </main>
  );
}
