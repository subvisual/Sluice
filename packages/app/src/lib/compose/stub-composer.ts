import type { Address, Hex } from "viem";
import { displayFrac, formatFixed } from "../amount";
import type { Position, Provenance, RiskRating, SlotRow } from "../book";
import { formatDayShort, formatDeadlineAbs } from "../time";
import { buildComposePrompt } from "./prompt";
import { TEMPLATES, templateId } from "./templates";
import type {
  ComposePrompt,
  RecommendationRequest,
  TokenMeta,
} from "./types";

/**
 * ⚠️ STUB — stands in for the sealed F2 round trip (0G enclave inference →
 * signature → deterministic gate I1–I14). The rail card says so on every
 * screen: "Sealed inference and market context are stubbed in this build.
 * Nothing here is signed."
 *
 * What is real: the request envelope, the prompt assembled through
 * `buildComposePrompt` (the exact bytes the enclave will receive), the budget
 * arithmetic (per-token ceilings are divided across strategies, never
 * repeated), and the deadline bounds. What is fixture: bands, levels, fee
 * tiers and descriptions — market context is F3 and is not wired, so these
 * are demo values, not observations.
 *
 * Because no enclave produced this, the recommendation is marked
 * `TEMPLATE_FALLBACK` — the provenance the product already defines for
 * "shown a template default instead of anything the model produced" — and the
 * UI renders that value rather than claiming an enclave signature it does not
 * have.
 */

export const COMPOSE_STEPS = [
  {
    label: "Reading market depth",
    detail: "the graph · pair context, realised vol — not wired, passing null",
  },
  {
    label: "Composing in enclave",
    detail: "0g · intel tdx · sealed inference, signed in place",
  },
  {
    label: "Validating",
    detail: "deterministic gate I1–I14 over the signed output",
  },
] as const;

export type StubStrategy = {
  templateId: Hex;
  /** Full label with the `T1 · ` prefix, as recommendation cards show it. */
  templateLabel: string;
  /** Label minus the prefix, as position cards show it. */
  templateShort: string;
  description: string;
  risk: RiskRating;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  /** 2-col fact grid: BAND/LEVEL · DEADLINE · one ceiling per request token. */
  facts: Array<{ label: string; value: string }>;
  legs: Array<{ token: TokenMeta; virtual: bigint }>;
  deadline: number;
  slots: SlotRow[];
};

export type StubRecommendation = {
  nonce: number;
  /** Always TEMPLATE_FALLBACK from this stub — no enclave produced it. */
  provenance: Provenance;
  /** Assembled through the real prompt builder; nothing has been sent. */
  prompt: ComposePrompt;
  strategies: StubStrategy[];
};

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function composeStub(opts: {
  request: RecommendationRequest;
  tokens: TokenMeta[];
  nonce: number;
  /** Called as each step begins, 0-indexed. */
  onStep: (step: number) => void;
}): Promise<StubRecommendation> {
  const prompt = buildComposePrompt({
    request: opts.request,
    tokens: opts.tokens,
    nonce: opts.nonce,
    // F3 is not wired. Passing null makes the prompt say so explicitly
    // instead of inventing depth and volatility numbers.
    context: null,
  });

  for (let step = 0; step < COMPOSE_STEPS.length; step++) {
    opts.onStep(step);
    await tick(1100);
  }

  return {
    nonce: opts.nonce,
    provenance: "TEMPLATE_FALLBACK",
    prompt,
    strategies: buildStrategies(opts.request, opts.tokens),
  };
}

/* ------------------------------------------------------------- strategies */

function buildStrategies(
  request: RecommendationRequest,
  tokens: TokenMeta[],
): StubStrategy[] {
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + request.maxDeadlineSec;
  const days = Math.round(request.maxDeadlineSec / 86_400);
  const deadlineFact = `${days}d · ${formatDayShort(deadline)}`;

  const committed = Object.entries(request.budget)
    .map(([addr, amount]) => ({
      token: tokens.find(
        (t) => t.address.toLowerCase() === addr.toLowerCase(),
      )!,
      amount,
    }))
    .filter((e) => e.token !== undefined);

  // T1 takes ¾ of every ceiling; T3 sells the remainder of the most volatile
  // committed token (highest-decimals) at a level. Sums stay within the
  // user's budget per token — dividing, never repeating (rule R4).
  const t1Legs = committed.map(({ token, amount }) => ({
    token,
    virtual: (amount * 3n) / 4n,
  }));
  const sellLeg = [...committed].sort(
    (a, b) => b.token.decimals - a.token.decimals,
  )[0];
  const t3Virtual = sellLeg.amount - (sellLeg.amount * 3n) / 4n;

  const strategies = [
    tightClmm(request, tokens, t1Legs, deadline, deadlineFact),
  ];
  if (request.maxStrategies >= 2 && t3Virtual > 0n) {
    strategies.push(
      oracleLimit(
        request,
        tokens,
        { token: sellLeg.token, virtual: t3Virtual },
        deadline,
        deadlineFact,
      ),
    );
  }
  return strategies;
}

const template = (slug: string) => {
  const t = TEMPLATES.find((t) => t.slug === slug)!;
  return {
    templateId: templateId(t.slug),
    templateLabel: t.label,
    templateShort: t.label.replace(/^T\d+ · /, ""),
  };
};

/** "USDC 9 000.000000 · WETH 3.000000000000000000" — full base-unit precision. */
const setupParams = (legs: Array<{ token: TokenMeta; virtual: bigint }>) =>
  legs
    .map(
      ({ token, virtual }) =>
        `${token.symbol} ${formatFixed(virtual, token.decimals, token.decimals)}`,
    )
    .join(" · ");

const deadlineParams = (deadline: number) =>
  `${deadline} · ${formatDeadlineAbs(deadline).replace(" · ", " ").replace(" UTC", "Z")}`;

const ceilingFacts = (
  request: RecommendationRequest,
  tokens: TokenMeta[],
  legs: Array<{ token: TokenMeta; virtual: bigint }>,
) =>
  Object.keys(request.budget).map((addr) => {
    const token = tokens.find(
      (t) => t.address.toLowerCase() === addr.toLowerCase(),
    )!;
    const leg = legs.find((l) => l.token.address === token.address);
    return {
      label: `${token.symbol.toUpperCase()} CEILING`,
      value: leg
        ? formatFixed(leg.virtual, token.decimals, displayFrac(token.decimals))
        : "—",
    };
  });

function tightClmm(
  request: RecommendationRequest,
  tokens: TokenMeta[],
  legs: Array<{ token: TokenMeta; virtual: bigint }>,
  deadline: number,
  deadlineFact: string,
): StubStrategy {
  return {
    ...template("tight-clmm"),
    description:
      "Quote a narrow band around 2 460 and earn fees on the flow that crosses it. Fills in pieces.",
    risk: "low",
    bandKind: "band",
    band: "2 400 – 2 520",
    bandNote: "USDC per ETH · narrow band, partial fills",
    facts: [
      { label: "BAND", value: "2 400 – 2 520" },
      { label: "DEADLINE", value: deadlineFact },
      ...ceilingFacts(request, tokens, legs),
    ],
    legs,
    deadline,
    slots: [
      { index: 1, name: "balance setup", instruction: "per-token setup", params: setupParams(legs) },
      { index: 2, name: "fees", instruction: "fee configuration", params: "5 bps" },
      { index: 3, name: "swap logic", instruction: "_xycConcentrateGrowLiquidityXD", params: "band 2 400 – 2 520 · 2 dims" },
      { index: 4, name: "oracle adjust", instruction: "— not used", params: "no feed required" },
      { index: 5, name: "invalidation", instruction: "_invalidateTokenIn1D", params: "required for partial fills" },
      { index: 6, name: "deadline", instruction: "_deadline", params: deadlineParams(deadline) },
    ],
  };
}

function oracleLimit(
  request: RecommendationRequest,
  tokens: TokenMeta[],
  leg: { token: TokenMeta; virtual: bigint },
  deadline: number,
  deadlineFact: string,
): StubStrategy {
  const amount = formatFixed(
    leg.virtual,
    leg.token.decimals,
    displayFrac(leg.token.decimals),
  );
  return {
    ...template("oracle-limit"),
    description: `If the price spikes past 2 800, sell ${amount} ${leg.token.symbol} in one go. Nothing happens below that level.`,
    risk: "medium",
    bandKind: "level",
    band: "sells at 2 800",
    bandNote: "USDC per ETH · all-or-nothing, oracle-adjusted",
    facts: [
      { label: "LEVEL", value: "sells at 2 800" },
      { label: "DEADLINE", value: deadlineFact },
      ...ceilingFacts(request, tokens, [leg]),
    ],
    legs: [leg],
    deadline,
    slots: [
      { index: 1, name: "balance setup", instruction: "per-token setup", params: setupParams([leg]) },
      { index: 2, name: "fees", instruction: "— not used", params: "no fee tier on a limit level" },
      { index: 3, name: "swap logic", instruction: "_limitSwapOnlyFull1D", params: "level 2 800 · full only" },
      { index: 4, name: "oracle adjust", instruction: "_oraclePriceAdjuster1D", params: "ETH/USD feed · 60s heartbeat" },
      { index: 5, name: "invalidation", instruction: "_invalidateBit1D", params: "single-use bit 0x11" },
      { index: 6, name: "deadline", instruction: "_deadline", params: deadlineParams(deadline) },
    ],
  };
}

/* -------------------------------------------------------------- shipping */

/**
 * What "Ship — 1 signature" turns the accepted set into. The real path signs
 * one `Multicall` and reads positions back from the book subgraph; neither is
 * wired, so the positions are built locally with a placeholder hash (a real
 * `strategyHash` is `keccak256(strategy bytes)` and needs the compiler).
 */
export function toPositions(
  rec: StubRecommendation,
  tokens: TokenMeta[],
): Position[] {
  const pair = [...tokens]
    .sort((a, b) => b.decimals - a.decimals)
    .map((t) => t.symbol)
    .join(" / ");

  return rec.strategies.map((s) => {
    const hash = placeholderHash();
    return {
      id: hash,
      strategyHash: hash,
      pair,
      templateLabel: s.templateShort,
      description: s.description,
      bandKind: s.bandKind,
      band: s.band,
      bandNote: s.bandNote,
      legs: s.legs.map(({ token, virtual }) => ({
        token: token.address as Address,
        symbol: token.symbol,
        decimals: token.decimals,
        virtual,
        consumed: 0n,
      })),
      fills: [],
      deadline: s.deadline,
      dockedAt: null,
      risk: s.risk,
      provenance: rec.provenance,
      slots: s.slots,
    };
  });
}

function placeholderHash(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
