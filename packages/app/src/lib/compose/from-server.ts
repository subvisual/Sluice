import type { Hex } from "viem";
import type { ServerComposeResult } from "@sluice/arbitration-sdk/serve";
import { TEMPLATES } from "@sluice/arbitration-sdk/grammar";
import { displayFrac, formatFixed, parseAmount } from "../amount";
import type { Position, Provenance, RiskRating, SlotRow } from "../book";
import { formatDayShort, formatDeadlineAbs } from "../time";
import { tokenBy } from "../tokens";
import type { TokenMeta } from "./types";

/**
 * ServerComposeResult → the shapes the compose screen renders. Pure mapping —
 * no fetch, no state. Labels come from the SDK's own TEMPLATES so the two
 * sides cannot drift; anything the SDK returns that the app cannot render
 * (an unknown token, an unknown template id) degrades to a visible raw value,
 * never a crash.
 */

export const COMPOSE_STEPS = [
  {
    label: "Reading market depth",
    detail: "the graph · your book from the aqua subgraph · pair data still stubbed",
  },
  {
    label: "Composing in enclave",
    detail: "0g · intel tdx · sealed inference, signed in place",
  },
  {
    label: "Validating",
    detail: "deterministic gate over the signed output — rejects, never rewrites",
  },
] as const;

export type UiStrategy = {
  templateId: string;
  templateLabel: string;
  templateShort: string;
  description: string;
  risk: RiskRating;
  bandKind: "band" | "level";
  band: string;
  bandNote: string;
  facts: Array<{ label: string; value: string }>;
  legs: Array<{ token: TokenMeta; virtual: bigint }>;
  deadline: number;
  slots: SlotRow[];
};

export type UiRecommendation = {
  nonce: number;
  provenance: Provenance;
  reason: string | null;
  proof: {
    signer: string | null;
    verified: boolean;
    latencyMs: number;
    proofUrl: string;
  } | null;
  validation: { ok: boolean; violations: Array<{ code: string; message: string }> };
  strategies: UiStrategy[];
};

// bandBps/feeBps are out of 1e9 (FEE_BPS_ONE) — see config/opcodes.8453.json.
const BPS_ONE = 1_000_000_000;
const pct = (bps: number) => `${((bps / BPS_ONE) * 100).toFixed(2)}%`;

export function fromServer(
  res: ServerComposeResult,
  nonce: number,
): UiRecommendation {
  return {
    nonce,
    provenance: res.source,
    reason: res.reason,
    proof: res.proof
      ? {
          signer: res.proof.signer,
          verified: res.proof.verified,
          latencyMs: res.proof.latencyMs,
          proofUrl: res.proof.proofUrl,
        }
      : null,
    validation: res.validation,
    strategies: res.recommendation.strategies.map(toUiStrategy),
  };
}

type ServerStrategy = ServerComposeResult["recommendation"]["strategies"][number];

function toUiStrategy(s: ServerStrategy): UiStrategy {
  const template = TEMPLATES.find((t) => t.id === s.templateId);
  const bandBps = Number(s.slots.band?.params?.bandBps ?? NaN);
  const feeBps = Number(s.slots.fee?.params?.feeBps ?? NaN);
  const deadline = s.slots.deadline.deadline;
  const days = Math.max(1, Math.round((deadline - Date.now() / 1000) / 86_400));

  const legs = s.tokens.flatMap((address, k) => {
    const token = tokenBy(address as `0x${string}`);
    // No app-side metadata → no way to render base units; the validator's I1
    // is what reports an out-of-budget token, so dropping the leg is display
    // honesty, not silence.
    if (!token) return [];
    // The model may emit more fraction digits than the token has (a 6-dp
    // USDC amount like "1000.3333333"). parseAmount rightly refuses to round
    // that — rounding a ceiling upward hands the composer more budget than
    // the user typed — so truncate the fraction down to the token's decimals
    // first. Truncating a ceiling downward is safe; it can only understate it.
    const truncated = truncateFraction(s.virtualAmounts[k], token.decimals);
    const virtual = parseAmount(truncated, token.decimals);
    return virtual !== null ? [{ token, virtual }] : [];
  });

  const band = Number.isFinite(bandBps) ? `±${pct(bandBps)}` : "full range";
  const feeText = Number.isFinite(feeBps) ? `${pct(feeBps)} maker fee` : "no maker fee";

  return {
    templateId: s.templateId,
    templateLabel: template?.label ?? s.templateId,
    templateShort: shortLabel(template?.label, s.templateId),
    description: template
      ? `${capitalize(template.describesIntent)} — ${feeText}, ${band === "full range" ? "across the whole curve" : `concentrated ${band} around mid`}.`
      : `Strategy shaped as ${s.templateId}.`,
    risk: s.slots.band ? "medium" : "low",
    bandKind: "band",
    band,
    bandNote:
      band === "full range"
        ? "constant product · fills at any price"
        : "around mid at observation · partial fills",
    facts: [
      { label: "BAND", value: band },
      { label: "DEADLINE", value: `${days}d · ${formatDayShort(deadline)}` },
      ...(Number.isFinite(feeBps) ? [{ label: "FEE", value: `${pct(feeBps)} maker fee` }] : []),
      ...legs.map(({ token, virtual }) => ({
        label: `${token.symbol.toUpperCase()} CEILING`,
        value: formatFixed(virtual, token.decimals, displayFrac(token.decimals)),
      })),
    ],
    legs,
    deadline,
    slots: [
      {
        index: 1,
        name: "curve",
        instruction: s.slots.curve.instruction,
        params: "constant-product amount computation",
      },
      {
        index: 2,
        name: "band",
        instruction: s.slots.band?.instruction ?? "— not used",
        params: s.slots.band ? `${band} around mid at observation` : "full range",
      },
      {
        index: 3,
        name: "fee",
        instruction: s.slots.fee?.instruction ?? "— not used",
        params: s.slots.fee ? `${pct(feeBps)} on amount in` : "no maker fee",
      },
      {
        index: 4,
        name: "deadline",
        instruction: "DEADLINE",
        params: `${deadline} · ${formatDeadlineAbs(deadline).replace(" · ", " ").replace(" UTC", "Z")}`,
      },
    ],
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Truncate a decimal string's fraction to at most `decimals` digits, never
 * rounding. Safe for a ceiling: dropping digits can only understate it, never
 * hand out more budget than the model actually asked for.
 */
function truncateFraction(input: string, decimals: number): string {
  const dot = input.indexOf(".");
  if (dot === -1) return input;
  const fraction = input.slice(dot + 1);
  if (fraction.length <= decimals) return input;
  const whole = input.slice(0, dot);
  return decimals === 0 ? whole : `${whole}.${fraction.slice(0, decimals)}`;
}

/**
 * The Positions screen's short label. The SDK's TEMPLATES label reads like
 * "banded · concentrate around the current price" — the part after the "·"
 * is the human-readable description; the slug-ish prefix is not. Falls back
 * to the full label (no "·" to split on), then to the raw templateId (no
 * template found at all).
 */
function shortLabel(label: string | undefined, templateId: string): string {
  if (!label) return templateId;
  const after = label.split("·")[1]?.trim();
  return after || label;
}

/**
 * What "Ship — 1 signature" turns the accepted set into. The real path signs
 * one `Multicall` and reads positions back from the book subgraph; neither is
 * wired, so the positions are built locally with a placeholder hash (a real
 * `strategyHash` is `keccak256(strategy bytes)` and needs the compiler).
 */
export function toPositions(
  rec: UiRecommendation,
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
        token: token.address,
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
