"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient, WalletClient } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
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
  type UiRecommendation,
  type UiStrategy,
} from "@/lib/compose/from-server";
import type { TokenSelection } from "@/lib/compose/types";
import type { ServerComposeResult } from "@sluice/arbitration-sdk/serve";
import { planShip, shipStrategies, type ShipPlan } from "@/lib/ship";
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
  const { recordShipped, refetch } = useBook();
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { balances, isLoading: balancesLoading } = useTokenBalances(address);
  // Ship needs both clients to sign/send; `walletClient` in particular
  // resolves asynchronously right after connecting, so there's a real (if
  // short) window where a validated recommendation exists but shipping would
  // silently no-op. The Ship button must not be clickable during that window
  // (Task 6 review finding 4) — folded into `RecommendationSet`'s `disabled`.
  const canShip = Boolean(walletClient && publicClient);

  const [prompt, setPrompt] = useState("");
  const [rows, setRows] = useState<Record<Address, PickerRow>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [rec, setRec] = useState<UiRecommendation | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [shipError, setShipError] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  // Which of the recommendation's strategies the user chose to ship, by index
  // into `rec.strategies` (and `rec.shipInputs` — compileRecommendation maps
  // the two 1:1). Everything arrives selected: the set is what was validated,
  // and unchecking is the deliberate act.
  const [selected, setSelected] = useState<number[]>([]);
  // Any edit invalidates an in-flight or finished run — the request changed.
  const runRef = useRef(0);

  const invalidate = () => {
    runRef.current += 1;
    setPhase("idle");
    setRec(null);
    setSelected([]);
    setShipError(null);
  };

  // Only the chosen strategies are shipped, exactly as they were recommended
  // and validated — amounts are never rescaled to soak up the budget the
  // unchosen ones would have used. Nothing rewrites a signed recommendation.
  const selectedInputs = useMemo(
    () => (rec ? selected.map((i) => rec.shipInputs[i]).filter(Boolean) : []),
    [rec, selected],
  );

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

  // `nonce` is a fixed field of the recommendation payload schema.
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
      const ui = fromServer(result, nonce);
      setRec(ui);
      setSelected(ui.strategies.map((_, i) => i));
      setPhase("done");
    } catch (e) {
      if (runRef.current !== run) return;
      setComposeError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      clearInterval(timer);
    }
  };

  // What signing the current selection costs, read from chain state before
  // anything is sent — so "one signature" is a fact on screen, not a hope.
  const { data: shipPlan } = useShipPlan({
    inputs: selectedInputs,
    account: address,
    publicClient: publicClient as PublicClient | undefined,
    walletClient,
  });

  const shipSelected = async () => {
    if (
      !rec ||
      !rec.validation.ok ||
      selectedInputs.length === 0 ||
      !address ||
      !walletClient ||
      !publicClient
    ) {
      return;
    }
    setShipError(null);
    setShipping(true);
    try {
      // One wallet signature over the Multicall (F1 §2). recordShipped caches
      // the metadata this recommendation carries — keyed by the real
      // strategyHash — so the dashboard's join can render it before the
      // subgraph has indexed the ship. Only the chosen strategies are cached:
      // the rest were never shipped and have no on-chain hash to key on.
      const { strategyHashes } = await shipStrategies({
        inputs: selectedInputs,
        account: address,
        walletClient,
        publicClient,
      });
      recordShipped(
        { ...rec, strategies: selected.map((i) => rec.strategies[i]) },
        strategyHashes,
      );
      refetch();
      router.push("/");
    } catch (e) {
      // ForkGuardError / user rejection / revert — an inline failure, never a
      // crash. Nothing was shipped; the set is still here to retry or decline.
      setShipError(e instanceof Error ? e.message : String(e));
    } finally {
      setShipping(false);
    }
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
          selected={selected}
          onToggle={(i) =>
            setSelected((prev) =>
              prev.includes(i)
                ? prev.filter((k) => k !== i)
                : [...prev, i].sort((a, b) => a - b),
            )
          }
          onDecline={invalidate}
          onShip={shipSelected}
          shipping={shipping}
          shipError={shipError}
          canShip={canShip}
          plan={shipPlan ?? null}
        />
      )}
    </div>
  );
}

/**
 * The allowance read behind the transaction count. Keyed on the selection, so
 * unchecking a strategy that was the only reason a token needed approving
 * updates the count too. `null` while it is in flight — the screen says
 * "checking" rather than promising a number it has not read yet.
 */
function useShipPlan(args: {
  inputs: UiRecommendation["shipInputs"];
  account: Address | undefined;
  publicClient: PublicClient | undefined;
  walletClient: WalletClient | undefined;
}) {
  const { inputs, account, publicClient, walletClient } = args;
  return useQuery<ShipPlan>({
    queryKey: [
      "ship-plan",
      account,
      Boolean(walletClient),
      inputs.map((i) => i.strategyHash).join(","),
    ],
    enabled: Boolean(account && publicClient && inputs.length > 0),
    queryFn: () =>
      planShip({
        inputs,
        account: account!,
        publicClient: publicClient!,
        walletClient,
      }),
  });
}

/**
 * The honest transaction count. Aqua pulls the maker's ERC20 only at fill time,
 * so a first-time approval is not what makes `ship()` succeed — it is what makes
 * the shipped position fillable — but it is still a signature, and saying "one
 * signature" while queueing two would be a lie the user discovers in their
 * wallet.
 */
function PlanNote({ plan }: { plan: ShipPlan | null }) {
  if (!plan) {
    return (
      <p className="mt-[5px] text-xs text-muted-3">Checking allowances…</p>
    );
  }
  if (plan.signatures === 1) {
    return (
      <p className="mt-[5px] text-xs text-muted-3">
        {plan.atomic
          ? "One transaction — the approval rides along in the same EIP-5792 batch."
          : "One transaction — Aqua is already approved for these tokens."}
      </p>
    );
  }
  return (
    <p className="mt-[5px] text-xs text-muted-3">
      {plan.signatures} transactions — your wallet cannot batch, so{" "}
      {plan.approvals.length === 1 ? "an approval" : `${plan.approvals.length} approvals`}{" "}
      must be signed first. Aqua pulls the tokens only when a taker fills.
    </p>
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
  selected,
  onToggle,
  onDecline,
  onShip,
  shipping,
  shipError,
  canShip,
  plan,
}: {
  rec: UiRecommendation;
  selected: number[];
  onToggle: (index: number) => void;
  onDecline: () => void;
  onShip: () => void;
  shipping: boolean;
  shipError: string | null;
  canShip: boolean;
  plan: ShipPlan | null;
}) {
  const n = rec.strategies.length;
  const chosen = selected.length;

  return (
    <section className="mt-8 animate-fade">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.02em]">
            Recommendation · {n} {n === 1 ? "strategy" : "strategies"}
          </h2>
          <p className="mt-[5px] text-[12.5px] text-muted">
            {rec.provenance === "ENCLAVE"
              ? "Signed in the enclave and validated. "
              : `Composed from a template seed — ${rec.reason ?? "sealed inference did not produce this"}. `}
            {n === 1
              ? "Ship it and it goes out as one signature."
              : "Choose which ones to ship — whatever you keep goes out in one signature."}
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
      {/* Book provenance (F3 job 1) — a stub book must say so on screen. */}
      <p className="mt-2 font-mono text-[10.5px] text-muted-3">
        book ·{" "}
        {rec.contextSource === "subgraph"
          ? "live from the aqua subgraph"
          : "stub — not your live book"}
      </p>
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
          <RecommendationCard
            key={`${s.templateId}-${i}`}
            strategy={s}
            selected={selected.includes(i)}
            onToggle={() => onToggle(i)}
            disabled={shipping}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[18px] border border-glass-line bg-card px-6 py-5 shadow-[var(--shadow-sm)]">
        <div>
          <p className="text-[13.5px] text-text-2">
            {chosen === 0 ? (
              "Nothing selected — pick at least one strategy to ship."
            ) : (
              <>
                {chosen === n
                  ? chosen === 1
                    ? "The strategy ships"
                    : `All ${n} strategies ship`
                  : `${chosen} of ${n} ship`}{" "}
                in a single{" "}
                <span className="font-mono text-[12.5px]">Multicall</span> — one
                signature.
              </>
            )}
          </p>
          {chosen > 0 && <PlanNote plan={plan} />}
          {/* Declining is a normal outcome — never styled as failure. */}
          <p className="mt-[5px] text-xs text-muted-3">
            Declining is a normal outcome; nothing has been sent anywhere yet.
          </p>
          {!rec.validation.ok && (
            <p className="mt-[5px] text-xs text-danger">
              The validator rejected this set — it cannot ship.
            </p>
          )}
          {shipError && (
            <p className="mt-[5px] text-xs leading-normal text-muted">
              <span className="mr-2 font-mono text-[10px] text-muted-3">FAILED</span>
              {shipError} — nothing was shipped.
            </p>
          )}
          {rec.validation.ok && !canShip && !shipping && (
            <p className="mt-[5px] text-xs text-muted-3">
              Waiting for your wallet client to be ready…
            </p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={onDecline}
            disabled={shipping}
            className="rounded-[10px] border border-glass-line bg-card-2 px-[18px] py-3 text-sm text-muted shadow-[var(--shadow-sm)] transition-colors hover:border-muted hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
          >
            Decline
          </button>
          <button
            onClick={onShip}
            disabled={!rec.validation.ok || shipping || !canShip || chosen === 0}
            className="rounded-[10px] bg-ink px-6 py-[13px] text-[15px] font-medium text-white shadow-[var(--shadow)] transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-[inset_0_0_0_1px_var(--border)]"
          >
            {shipping
              ? "Shipping…"
              : chosen === 0
                ? "Ship"
                : `Ship ${chosen === n ? "" : `${chosen} `}— ${plan?.signatures ?? 1} signature${(plan?.signatures ?? 1) === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </section>
  );
}

function RecommendationCard({
  strategy,
  selected,
  onToggle,
  disabled,
}: {
  strategy: UiStrategy;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`flex flex-col gap-4 rounded-[18px] border bg-card p-[22px] shadow-[var(--shadow-sm)] transition-colors ${
        selected
          ? "border-aqua-line ring-1 ring-aqua-line"
          : "border-glass-line opacity-60"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-muted">
            {strategy.templateLabel}
          </div>
          <p className="mt-2 text-[15px] leading-[1.55] text-pretty">
            {strategy.description}
          </p>
        </div>
        <RiskChip risk={strategy.risk} />
      </div>

      {/* The choice itself. A strategy the user unchecks is simply not shipped
          — its amounts are never moved onto the ones that are. */}
      <button
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={selected}
        className={`flex items-center gap-2.5 self-start rounded-lg border px-3 py-2 text-[12.5px] transition-colors disabled:cursor-not-allowed ${
          selected
            ? "border-aqua-line bg-aqua-soft text-aqua-text"
            : "border-border bg-surface-2 text-muted hover:border-muted hover:text-text"
        }`}
      >
        <span className="font-mono text-[11px]">{selected ? "✓" : "＋"}</span>
        {selected ? "Selected to ship" : "Ship this one"}
      </button>

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
