"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import { parseAmount } from "@/lib/amount";
import { useBook } from "@/lib/book";
import { EXPECTED_CHAIN_ID, REQUEST_DEFAULTS } from "@/lib/compose/constants";
import {
  buildRecommendationRequest,
  type RequestIssue,
} from "@/lib/compose/request";
import {
  COMPOSE_STEPS,
  fromServer,
  toPositions,
  type UiRecommendation,
  type UiStrategy,
} from "@/lib/compose/from-server";
import type { TokenSelection } from "@/lib/compose/types";
import type { ServerComposeResult } from "@sluice/arbitration-sdk/serve";
import { TOKENS } from "@/lib/tokens";
import { useTokenBalances } from "@/lib/use-token-balances";
import { ProvenanceChip, RiskChip } from "./chips";
import { PromptBox } from "./prompt-box";
import { SlotTable } from "./slot-table";
import { TokenPicker, type PickerRow } from "./token-picker";

/**
 * Compose — "this is the entire input: a sentence and a budget."
 *
 * Validation is `buildRecommendationRequest()`, not re-derived here; the only
 * screen-level check is MALFORMED (an unparseable amount never becomes a
 * bigint, so the builder cannot see it). The composer round trip calls the
 * real `POST /api/compose` route — see `from-server.ts` for how the response
 * maps onto what this screen renders.
 */

type Phase = "idle" | "composing" | "done";

export function ComposeScreen() {
  const router = useRouter();
  const { ship } = useBook();
  const { address, chainId, isConnected } = useConnection();
  const { balances, isLoading: balancesLoading } = useTokenBalances(address);

  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState<Record<Address, PickerRow>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [rec, setRec] = useState<UiRecommendation | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  // Any edit invalidates an in-flight or finished run — the request changed.
  const runRef = useRef(0);

  const invalidate = () => {
    runRef.current += 1;
    setPhase("idle");
    setRec(null);
  };

  const malformed = useMemo(
    () =>
      TOKENS.filter((t) => {
        const row = rows[t.address];
        return (
          row?.selected &&
          row.input.trim() !== "" &&
          parseAmount(row.input, t.decimals) === null
        );
      }),
    [rows],
  );

  // Malformed rows are excluded — there is no bigint to carry them in.
  const selections: TokenSelection[] = useMemo(
    () =>
      TOKENS.filter(
        (t) =>
          rows[t.address]?.selected &&
          !malformed.some((m) => m.address === t.address),
      ).map((t) => ({
        token: t.address,
        amount: parseAmount(rows[t.address]?.input ?? "", t.decimals) ?? 0n,
      })),
    [rows, malformed],
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

  const issues: RequestIssue[] = useMemo(() => {
    const base = built.ok ? [] : built.issues;
    return [
      // A malformed row otherwise double-reports as NO_TOKENS.
      ...(malformed.length > 0
        ? base.filter((i) => i.code !== "NO_TOKENS")
        : base),
      ...malformed.map((t) => ({
        code: "MALFORMED" as const,
        message: `${t.symbol}: that is not a number we can read.`,
      })),
    ];
  }, [built, malformed]);

  const ok = built.ok && malformed.length === 0;

  // `nonceOf[user] + 1` (I13). RecommendationRegistry is not deployed yet, so
  // this is a stand-in.
  const nonce = 1;

  const compose = async () => {
    if (!ok || !built.ok) return;
    const run = ++runRef.current;
    setPhase("composing");
    setStep(0);
    setRec(null);
    setComposeError(null);

    // Cosmetic pacing (design decision 4): the steps advance on a timer while
    // the round trip is in flight and snap to done when the response lands —
    // they are pacing, not claims about server state.
    const timer = setInterval(() => {
      if (runRef.current === run) {
        setStep((s) => Math.min(s + 1, COMPOSE_STEPS.length - 1));
      }
    }, 1400);

    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user: built.request.user,
          prompt: built.request.prompt,
          budget: Object.entries(built.request.budget).map(
            ([address, amount]) => ({ address, amount: amount.toString() }),
          ),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `compose failed with status ${res.status}`);
      }
      const result = (await res.json()) as ServerComposeResult;
      if (runRef.current !== run) return;
      setRec(fromServer(result, nonce));
      setPhase("done");
    } catch (e) {
      if (runRef.current !== run) return;
      setComposeError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      clearInterval(timer);
    }
  };

  const shipSet = () => {
    if (!rec) return;
    // Real path: one wallet signature over the Multicall, then the book
    // subgraph picks the positions up. Neither is wired yet — see from-server.
    ship(toPositions(rec, TOKENS));
    router.push("/");
  };

  return (
    <div className="mx-auto max-w-[1180px]">
      <Link
        href="/"
        className="mb-5 inline-block text-[13px] text-muted transition-colors hover:text-text"
      >
        ← Positions
      </Link>

      <div className="mb-6">
        <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.025em]">
          New strategy
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          This is the entire input: a sentence and a budget.
        </p>
      </div>

      <div className="flex max-w-[760px] flex-col gap-4">
        <PromptBox
          value={prompt}
          onChange={(v) => {
            setPrompt(v);
            invalidate();
          }}
        />

        <TokenPicker
          tokens={TOKENS}
          rows={rows}
          balances={balances}
          balancesLoading={balancesLoading && isConnected}
          onChange={(token, row) => {
            setRows((prev) => ({ ...prev, [token]: row }));
            invalidate();
          }}
        />

        <section className="rounded-[18px] border border-glass-line bg-card p-6 shadow-[var(--shadow-sm)]">
          <h3 className="mb-3.5 font-mono text-[10.5px] tracking-[0.09em] text-muted-2">
            REQUEST LIMITS · READ-ONLY
          </h3>
          <div className="flex flex-col gap-2.5">
            <LimitRow label="maxStrategies" value={String(REQUEST_DEFAULTS.maxStrategies)} />
            <LimitRow label="maxDeadline" value={`${REQUEST_DEFAULTS.maxDeadlineSec / 86400}d`} />
            <LimitRow label="retries" value={String(REQUEST_DEFAULTS.maxInferenceRetries)} />
          </div>

          <button
            disabled={!ok || phase === "composing"}
            onClick={compose}
            className="mt-5 w-full rounded-lg bg-ink px-5 py-[13px] text-[15px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--border)]"
          >
            {phase === "composing" ? "Composing…" : "Compose"}
          </button>

          {composeError && (
            <p className="mt-3 text-xs leading-normal text-muted">
              <span className="mr-2 font-mono text-[10px] text-muted-3">FAILED</span>
              {composeError} — nothing was composed.
            </p>
          )}

          {issues.length > 0 && (
            <ul className="mt-4 flex flex-col gap-[7px] border-t border-border pt-4">
              {issues.map((issue) => (
                <li
                  key={issue.code + issue.message}
                  className="text-xs leading-normal text-muted"
                >
                  <span className="mr-2 font-mono text-[10px] text-muted-3">
                    {issue.code}
                  </span>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        {phase === "composing" && <ComposingCard step={step} />}
      </div>

      {phase === "done" && rec && (
        <RecommendationSet
          rec={rec}
          onDecline={invalidate}
          onShip={shipSet}
        />
      )}
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[13px] tabular-nums">{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------- composing */

function ComposingCard({ step }: { step: number }) {
  return (
    <section className="rounded-[18px] border border-glass-line bg-card p-6 shadow-[var(--shadow-sm)]">
      <h3 className="mb-4 font-mono text-[10.5px] tracking-[0.09em] text-aqua-text">
        COMPOSING · SEALED
      </h3>
      <div className="flex flex-col gap-3.5">
        {COMPOSE_STEPS.map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <div key={s.label} className="flex items-start gap-3">
              <span
                className={`flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[11px] ${
                  done
                    ? "bg-aqua-soft text-aqua-text"
                    : current
                      ? "animate-step bg-surface-2 text-aqua-text"
                      : "bg-surface-2 text-muted-3"
                }`}
              >
                {done ? "✓" : current ? "›" : "·"}
              </span>
              <div className="min-w-0">
                <div
                  className={`text-[13.5px] ${
                    done || current ? "text-text" : "text-muted-3"
                  }`}
                >
                  {s.label}
                </div>
                <div className="mt-[3px] font-mono text-[10.5px] leading-normal text-muted-3">
                  {s.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-[18px] text-[11.5px] leading-relaxed text-muted-3">
        Inference runs inside the enclave. The response is signed there; a
        deterministic validator checks it before you ever see it.
      </p>
    </section>
  );
}

/* -------------------------------------------------------------- results */

function RecommendationSet({
  rec,
  onDecline,
  onShip,
}: {
  rec: UiRecommendation;
  onDecline: () => void;
  onShip: () => void;
}) {
  const n = rec.strategies.length;

  return (
    <section className="mt-8 animate-fade">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em]">
            Recommendation · {n} {n === 1 ? "strategy" : "strategies"}
          </h2>
          <p className="mt-[5px] text-[12.5px] text-muted">
            {rec.provenance === "ENCLAVE"
              ? "Signed in the enclave and validated. Accept the set and it ships as one signature."
              : `Composed from a template seed — ${rec.reason ?? "sealed inference did not produce this"}. Accept the set and it ships as one signature.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProvenanceChip provenance={rec.provenance} />
          <span className="rounded-md border border-border px-2.5 py-[5px] font-mono text-[10px] text-muted">
            nonce <span className="text-text">{rec.nonce}</span>
          </span>
        </div>
      </div>
      {rec.proof && (
        <p className="mt-2 font-mono text-[10.5px] text-muted-3">
          signer {rec.proof.signer ?? "(recovery failed)"} ·{" "}
          {rec.proof.verified ? "verified" : "unverified"} · {rec.proof.latencyMs}ms
        </p>
      )}
      {!rec.validation.ok && (
        <ul className="mt-2 flex flex-col gap-1">
          {rec.validation.violations.map((v) => (
            <li key={v.code + v.message} className="text-xs text-muted">
              <span className="mr-2 font-mono text-[10px] text-muted-3">{v.code}</span>
              {v.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(400px,1fr))]">
        {rec.strategies.map((s, i) => (
          <RecommendationCard key={`${s.templateId}-${i}`} strategy={s} />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-glass-line bg-card px-6 py-5 shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-[13.5px] text-text-2">
            {n === 1 ? "The strategy ships" : n === 2 ? "Both strategies ship" : `All ${n} strategies ship`}{" "}
            in a single{" "}
            <span className="font-mono text-[12.5px]">Multicall</span> — one
            signature.
          </p>
          {/* Declining is a normal outcome — never styled as failure. */}
          <p className="mt-[5px] text-xs text-muted-3">
            Declining is a normal outcome; nothing has been sent anywhere yet.
          </p>
          {!rec.validation.ok && (
            <p className="mt-[5px] text-xs text-danger">
              The validator rejected this set — it cannot ship.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onDecline}
            className="rounded-[10px] border border-glass-line bg-card-2 px-[18px] py-3 text-sm text-muted shadow-[var(--shadow-sm)] transition-colors hover:border-muted hover:text-text"
          >
            Decline
          </button>
          <button
            onClick={onShip}
            disabled={!rec.validation.ok}
            className="rounded-[10px] bg-ink px-6 py-[13px] text-[15px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--border)]"
          >
            Ship — 1 signature
          </button>
        </div>
      </div>
    </section>
  );
}

function RecommendationCard({ strategy }: { strategy: UiStrategy }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-4 rounded-[18px] border border-glass-line bg-card p-[22px] shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] text-muted">
            {strategy.templateLabel}
          </div>
          <p className="mt-2 text-[15px] leading-[1.55] text-pretty">
            {strategy.description}
          </p>
        </div>
        <RiskChip risk={strategy.risk} />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-4">
        {strategy.facts.map((fact) => (
          <div key={fact.label}>
            <div className="font-mono text-[10px] tracking-[0.06em] text-muted-2">
              {fact.label}
            </div>
            <div className="mt-[5px] font-mono text-sm tabular-nums">
              {fact.value}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between gap-2.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[12.5px] text-text-2 transition-colors hover:border-muted"
      >
        <span>Why this</span>
        <span className="font-mono text-[11px] text-muted">
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded && <SlotTable slots={strategy.slots} variant="card" />}
    </div>
  );
}
