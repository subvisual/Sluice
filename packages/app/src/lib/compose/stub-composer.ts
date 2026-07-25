import type { Address, Hex } from "viem";
import {
  DEFAULT_BAND_BPS,
  DEFAULT_FEE_BPS,
  selectTemplate,
} from "../../../../arbitration-sdk/src/fallback.ts";
import {
  BAND,
  CURVES,
  DEADLINE,
  WRAPPERS,
  type Template,
} from "../../../../arbitration-sdk/src/grammar.ts";
import { FEE_BPS_ONE } from "../../../../arbitration-sdk/src/opcodes.ts";
import { displayFrac, formatFixed } from "../amount";
import type { Position, Provenance, RiskRating, SlotRow } from "../book";
import { formatDayShort, formatDeadlineAbs } from "../time";
import { buildComposePrompt } from "./prompt";
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
 * `buildComposePrompt` (the exact bytes the enclave will receive), the
 * template selection (the SDK's own deterministic `selectTemplate` heuristic —
 * the same one the real TEMPLATE_FALLBACK path uses), the slot shape and
 * default band/fee parameters (the SDK's fallback defaults), the budget
 * arithmetic (the strategy draws exactly the ceilings the user declared), and
 * the deadline bounds. What is fixture: risk ratings and the prose
 * descriptions — market context is F3 and is not wired, so nothing here is an
 * observation.
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

/// The venue's fee instruction and curve — the menu holds exactly one of each.
const [FEE] = WRAPPERS;
const [CURVE] = CURVES;

export type StubStrategy = {
  /** A seed template id from the SDK grammar, e.g. "banded-fee". */
  templateId: string;
  templateLabel: string;
  description: string;
  risk: RiskRating;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  /** 2-col fact grid: BAND · DEADLINE · one ceiling per request token. */
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

  const legs = Object.entries(request.budget)
    .map(([addr, amount]) => ({
      token: tokens.find(
        (t) => t.address.toLowerCase() === addr.toLowerCase(),
      )!,
      virtual: amount,
    }))
    .filter((e) => e.token !== undefined);

  // Mirrors the SDK's deterministic fallback (fallback.ts): the same keyword
  // heuristic picks ONE seed template, and the one strategy draws exactly the
  // ceilings the user declared — their tokens, their amounts (rule R6).
  return [
    fromTemplate(selectTemplate(request.prompt), request, tokens, legs, deadline, deadlineFact),
  ];
}

function fromTemplate(
  t: Template,
  request: RecommendationRequest,
  tokens: TokenMeta[],
  legs: Array<{ token: TokenMeta; virtual: bigint }>,
  deadline: number,
  deadlineFact: string,
): StubStrategy {
  const hasBand = t.wrappers.includes(BAND.name);
  const hasFee = t.wrappers.includes(FEE.name);
  const bandPct = pct(DEFAULT_BAND_BPS);
  const feePct = pct(DEFAULT_FEE_BPS);

  const feeSentence = hasFee
    ? ` A ${feePct} maker fee is taken on every fill.`
    : "";
  const description = hasBand
    ? `Concentrate the committed liquidity into a ±${bandPct} band around the shipped price — deeper quotes inside the band, and the inventory drains exactly at its edges.${feeSentence}`
    : `Make a market across the whole curve: the shipped amounts set the price and the depth.${feeSentence}`;

  const band = hasBand ? `±${bandPct} of shipped price` : "full range";

  return {
    templateId: t.id,
    templateLabel: t.label,
    description,
    // Fixture ratings: a band exhausts on a move past its edge, the full
    // curve does not — nothing here is a market observation.
    risk: hasBand ? "medium" : "low",
    bandKind: "band",
    band,
    bandNote: hasBand
      ? "geometric band around the shipped ratio · drains at the edges"
      : "constant product · the shipped ratio sets the price",
    facts: [
      { label: "BAND", value: band },
      { label: "DEADLINE", value: deadlineFact },
      ...ceilingFacts(request, tokens, legs),
    ],
    legs,
    deadline,
    slots: [
      hasBand
        ? {
            index: 1,
            name: "band",
            instruction: BAND.name,
            params: `bandBps ${group(DEFAULT_BAND_BPS)} · ±${bandPct}`,
          }
        : {
            index: 1,
            name: "band",
            instruction: "— not used",
            params: "full range — no concentration",
          },
      hasFee
        ? {
            index: 2,
            name: "fee",
            instruction: FEE.name,
            params: `feeBps ${group(DEFAULT_FEE_BPS)} · ${feePct} on amountIn`,
          }
        : {
            index: 2,
            name: "fee",
            instruction: "— not used",
            params: "no maker fee",
          },
      {
        index: 3,
        name: "curve",
        instruction: CURVE.name,
        params: "no args · price = shipped ratio, depth = shipped size",
      },
      {
        index: 4,
        name: "deadline",
        instruction: DEADLINE.name,
        params: deadlineParams(deadline),
      },
    ],
  };
}

/** Out of FEE_BPS_ONE (1e9 = 100%): 10 000 000 → "1%", 500 000 → "0.05%". */
const pct = (bps: number) =>
  `${Number(((bps / FEE_BPS_ONE) * 100).toFixed(4))}%`;

/** "10 000 000" — grouped for reading, still base-1e9 units. */
const group = (n: number) =>
  String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

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
      templateLabel: s.templateLabel,
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
