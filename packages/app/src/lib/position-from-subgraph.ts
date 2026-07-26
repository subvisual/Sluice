import type { Address } from "viem";
import type { MakerPosition, MakerPositionFill } from "@sluice/arbitration-sdk/subgraph";
import {
  decodeOrder,
  decodeProgram,
  deadlineOf,
  fromHex,
  toHex,
  type Instruction,
} from "@sluice/arbitration-sdk/swapvm";
import { opcodeName } from "@sluice/arbitration-sdk/opcodes";
import { TEMPLATES } from "@sluice/arbitration-sdk/grammar";
import { displayFrac, formatFixed } from "./amount";
import { feeSlotParams, shortLabel } from "./compose/from-server";
import type { Fill, SlotRow } from "./book";
import type { PositionDto, PositionLegDto } from "./position-dto";
import { formatDayShort, formatDeadlineAbs } from "./time";
import { tokenBy } from "./tokens";

/**
 * Subgraph strategy row → the dashboard's Position shape (server-side; the
 * program decode pulls in ethers, which must not reach the client bundle).
 *
 * Everything here is read back from the chain: the ceiling is `initialVirtual`
 * from the ship-funding event, consumed is `totalPulled`, and the deadline and
 * slot rows come from decoding `strategyData` itself. What cannot be read back
 * — risk rating, provenance, the recommendation's wording — is null or
 * labelled as unavailable, never invented.
 */

// Each template's exact instruction sequence, as the compiler emits it
// (swapvm.ts fullRange/banded/…). A program is only labelled with a template
// when it matches one of these exactly — anything else is a foreign program
// and says so.
const TEMPLATE_SEQUENCES: Record<string, string> = {
  "SALT,DEADLINE,XYC_SWAP_XD": "full-range",
  "SALT,DEADLINE,FLAT_FEE_AMOUNT_IN_XD,XYC_SWAP_XD": "full-range-fee",
  "SALT,DEADLINE,XYC_CONCENTRATE_GROW_LIQUIDITY_2D,XYC_SWAP_XD": "banded",
  "SALT,DEADLINE,XYC_CONCENTRATE_GROW_LIQUIDITY_2D,FLAT_FEE_AMOUNT_IN_XD,XYC_SWAP_XD":
    "banded-fee",
};

export function toPositionDto(row: MakerPosition): PositionDto {
  const legs = toLegs(row);
  const pair =
    legs.length > 0
      ? [...legs]
          .sort((a, b) => b.decimals - a.decimals)
          .map((l) => l.symbol)
          .join(" / ")
      : "unfunded";

  const decoded = decode(row.strategyData);

  return {
    id: row.id,
    strategyHash: row.strategyHash as `0x${string}`,
    pair,
    templateLabel: decoded.templateLabel,
    description: decoded.description,
    bandKind: "band",
    band: decoded.band,
    bandNote: decoded.bandNote,
    legs,
    fills: row.fills.map(toFill),
    deadline: decoded.deadline,
    dockedAt: row.dockedAt,
    // Not recoverable from the chain.
    risk: null,
    provenance: null,
    slots: decoded.slots,
  };
}

/* ------------------------------------------------------------------ decode */

type Decoded = {
  deadline: number | null;
  slots: SlotRow[];
  templateLabel: string;
  description: string;
  band: string;
  bandNote: string;
};

function decode(strategyData: string): Decoded {
  let instructions: Instruction[];
  try {
    instructions = decodeProgram(decodeOrder(fromHex(strategyData)).program);
  } catch {
    // Bytes that are not abi.encode(Order) or hold a malformed program: still
    // a real position (real ceilings, real fills) — shown with what we know.
    return {
      deadline: null,
      slots: [
        {
          index: 1,
          name: "program",
          instruction: "— undecodable",
          params: "strategy bytes did not decode as an Aqua-mode SwapVM order",
        },
      ],
      templateLabel: "on-chain program",
      description:
        "Shipped on-chain, but the strategy bytes could not be decoded as a SwapVM program.",
      band: "unknown",
      bandNote: "program not decodable",
    };
  }

  const names = instructions.map((ins) => opcodeName(ins.opcode));
  const templateId = TEMPLATE_SEQUENCES[names.join(",")];
  const template = TEMPLATES.find((t) => t.id === templateId);
  const hasBand = names.some((n) => n.startsWith("XYC_CONCENTRATE"));

  return {
    deadline: deadlineOf(instructions),
    slots: instructions.map(toSlotRow),
    templateLabel: template ? shortLabel(template.label, template.id) : "on-chain program",
    description: template
      ? `${capitalize(template.describesIntent)} — read back from the aqua subgraph.`
      : "On-chain program read back from the aqua subgraph — shipped outside this composer.",
    band: hasBand ? "banded" : "full range",
    bandNote: hasBand
      ? "concentrated around the shipped price · exact width lives in the signed recommendation"
      : "constant product · fills at any price",
  };
}

function toSlotRow(ins: Instruction, i: number): SlotRow {
  const name = opcodeName(ins.opcode);
  return {
    index: i + 1,
    name: slotName(name),
    instruction: name,
    params: slotParams(name, ins),
  };
}

function slotName(opName: string): string {
  if (opName === "SALT") return "salt";
  if (opName === "DEADLINE") return "deadline";
  if (opName === "XYC_SWAP_XD") return "curve";
  if (opName.startsWith("XYC_CONCENTRATE")) return "band";
  if (opName.includes("FEE")) return "fee";
  return opName.toLowerCase();
}

function slotParams(opName: string, ins: Instruction): string {
  if (opName === "DEADLINE") {
    const unix = uintOf(ins.args);
    return `${unix} · ${formatDeadlineAbs(unix).replace(" · ", " ").replace(" UTC", "Z")}`;
  }
  if (opName === "XYC_SWAP_XD") return "constant-product amount computation";
  if (opName.startsWith("XYC_CONCENTRATE"))
    return "liquidity deltas computed from the ship amounts";
  if (opName === "FLAT_FEE_AMOUNT_IN_XD") return feeSlotParams(uintOf(ins.args));
  return ins.args.length ? toHex(ins.args) : "—";
}

const uintOf = (args: Uint8Array): number => {
  let value = 0n;
  for (const b of args) value = (value << 8n) | BigInt(b);
  return Number(value);
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* -------------------------------------------------------------- legs/fills */

function toLegs(row: MakerPosition): PositionLegDto[] {
  return row.balances.map((bal) => {
    const meta = tokenBy(bal.tokenAddress as Address);
    const initial = BigInt(bal.initialVirtual);
    // Live/expired: consumed = ceiling − current remaining, net of pushes —
    // a fill that pushed this token back in has un-consumed it. Docked: the
    // remaining balance was zeroed by the dock refund, not by fills, so use
    // net pulls instead. Clamped to [0, ceiling] either way: the display bar
    // is a fraction of the ceiling, never more.
    const raw =
      row.status === "DOCKED"
        ? BigInt(bal.totalPulled) - BigInt(bal.totalPushed)
        : initial - BigInt(bal.virtualBalance);
    const consumed = raw < 0n ? 0n : raw > initial ? initial : raw;
    return {
      token: bal.tokenAddress as Address,
      symbol: bal.symbol ?? meta?.symbol ?? shortAddr(bal.tokenAddress),
      // decimals 0 = unknown scale: raw base units, never a guessed division.
      decimals: bal.decimals ?? meta?.decimals ?? 0,
      virtual: bal.initialVirtual,
      consumed: consumed.toString(),
    };
  });
}

/** "+1 204.50 USDC  →  −0.4900 WETH" — the maker receives amountIn. */
function toFill(f: MakerPositionFill): Fill {
  const d = new Date(f.ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    time: `${formatDayShort(f.ts)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    flow: `+${side(f.amountIn, f.tokenInDecimals, f.tokenInSymbol)}  →  −${side(f.amountOut, f.tokenOutDecimals, f.tokenOutSymbol)}`,
  };
}

function side(raw: string, decimals: number | null, symbol: string | null): string {
  const amount =
    decimals !== null ? formatFixed(BigInt(raw), decimals, displayFrac(decimals)) : raw;
  return symbol !== null ? `${amount} ${symbol}` : amount;
}

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
