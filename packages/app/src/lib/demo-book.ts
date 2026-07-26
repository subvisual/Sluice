import type { Hex } from "viem";
import { TEMPLATES } from "@sluice/arbitration-sdk/grammar";
import type { Position } from "./book";
import { TOKENS } from "./tokens";
import { formatDayShort, formatDeadlineAbs } from "./time";

/**
 * ⚠️ DEMO fixtures — positions from the design prototype, covering every card
 * and sheet state: live, live-near-deadline, expired with no risk rating, and
 * docked.
 *
 * Seeded by the "Show demo positions" button in the dashboard's empty state, so
 * every screen can be shown without the real book. Deadlines and fill times are
 * derived from "now" so each fixture stays in its intended state whenever it is
 * loaded. Nothing here is, or claims to be, on-chain.
 *
 * Shapes follow the settled SDK grammar (the four seed templates over the
 * deployed router), and labels/slot rows mirror how `from-server.ts` renders a
 * real recommendation — so a demo card and a shipped card read identically.
 * Prices, band widths, fees and fills are demo values.
 */
/**
 * Demo-only tokens, deliberately NOT in `config/addresses.8453.json` — that
 * file is the product's supported-token list and feeds the budget picker. These
 * exist only so fixture positions show pair variety. Base addresses where
 * deployed (USDT, DAI); canonical mainnet addresses for AAVE/UNI, whose art the
 * icon lookup finds via its `ethereum` fallback.
 */
const DEMO_TOKENS = {
  USDT: { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  DAI: { symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  AAVE: { symbol: "AAVE", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18 },
  UNI: { symbol: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18 },
} as const;

type DemoToken = {
  symbol: string;
  address: string;
  decimals: number;
};

/**
 * Same short label a real position gets (`shortLabel` in from-server.ts): the
 * human half after the "·" of the SDK label, or the whole label without one.
 */
const label = (id: string) => {
  const full = TEMPLATES.find((t) => t.id === id)!.label;
  return full.split("·")[1]?.trim() || full;
};

export function demoBook(): Position[] {
  const now = Math.floor(Date.now() / 1000);
  const usdc = TOKENS.find((t) => t.symbol === "USDC")!;
  const weth = TOKENS.find((t) => t.symbol === "WETH")!;
  const { USDT, DAI, AAVE, UNI } = DEMO_TOKENS;
  const leg = (
    token: DemoToken,
    virtual: bigint,
    consumed: bigint,
  ) => ({
    token: token.address as Position["legs"][number]["token"],
    symbol: token.symbol,
    decimals: token.decimals,
    virtual,
    consumed,
  });

  const H = 3_600;
  const D = 86_400;

  return [
    {
      id: "demo-1",
      strategyHash:
        "0x7c41aa06de1b9f21c05c1d87c3b1a2f4e8d90b6c41d2530a9b8e7f6a5c4d9f3e" as Hex,
      pair: "WETH / USDC",
      templateLabel: label("banded-fee"),
      description:
        "Concentrates both sides into a ±1% band around 2 460 USDC per ETH and takes a 0.05% maker fee on the flow that crosses it. Quotes deep inside the band; the inventory drains exactly at its edges.",
      bandKind: "band",
      band: "2 435 – 2 485",
      bandNote: "USDC per ETH · ±1.00% band, fee on every fill",
      legs: [
        leg(usdc, 12_000_000_000n, 4_380_150_000n),
        leg(weth, 4_000000000000000000n, 1_241000000000000000n),
      ],
      fills: [
        fill(now - 8 * H, "+1 204.50 USDC  →  −0.4900 WETH"),
        fill(now - 20 * H, "−1 902.65 USDC  →  +0.7510 WETH"),
        fill(now - 30 * H, "+1 273.00 USDC  →  −0.5000 WETH"),
      ],
      deadline: now + 5 * D + 12 * H,
      dockedAt: null,
      risk: "low",
      provenance: "ENCLAVE",
      slots: slotRows({ bandBps: 10_000_000, feeBps: 500_000, deadline: now + 5 * D + 12 * H }),
    },
    {
      id: "demo-2",
      strategyHash:
        "0x2b90e3a1f7c8d6b5a4938271605f4e3d2c1b0a9988776655d417c3b2a1908d41" as Hex,
      pair: "WETH / USDC",
      templateLabel: label("full-range-fee"),
      description:
        "Quotes WETH against USDC across the whole curve with a 0.05% maker fee. No band to drain — the full commitment rides the price wherever it goes until the deadline unwinds it.",
      bandKind: "band",
      band: "full range",
      bandNote: "USDC per ETH · whole curve, no concentration",
      legs: [
        leg(weth, 2_500000000000000000n, 0n),
        leg(usdc, 6_500_000_000n, 0n),
      ],
      fills: [],
      deadline: now + 18 * H,
      dockedAt: null,
      risk: "medium",
      provenance: "ENCLAVE",
      slots: slotRows({ feeBps: 500_000, deadline: now + 18 * H }),
    },
    {
      id: "demo-3",
      strategyHash:
        "0xa10c99887766554433221100ffeeddccbbaa5b2299887766554433221100fedc" as Hex,
      pair: "WETH / USDC",
      templateLabel: label("banded"),
      description:
        "Held a wide ±15% band around 2 500 USDC per ETH, waiting for the price to come to it. It expired with most of its commitment untouched and has unwound automatically.",
      bandKind: "band",
      band: "2 125 – 2 875",
      bandNote: "USDC per ETH · ±15.00% band, patient",
      legs: [
        leg(usdc, 8_000_000_000n, 1_210_400_000n),
        leg(weth, 3_200000000000000000n, 482000000000000000n),
      ],
      fills: [fill(now - 4 * D, "+1 210.40 USDC  →  −0.4820 WETH")],
      deadline: now - 2 * D,
      dockedAt: null,
      // Absent on purpose: the card must say "risk rating unavailable".
      risk: null,
      provenance: "ENCLAVE",
      slots: slotRows({ bandBps: 150_000_000, deadline: now - 2 * D }),
    },
    {
      id: "demo-4",
      strategyHash:
        "0x55e7d4c3b2a190887766554433221100aabbccddeeff00112233445566770a91" as Hex,
      pair: "WETH / USDC",
      templateLabel: label("banded-fee"),
      description:
        "A tight ±0.5% banded quote around 2 500 USDC per ETH you closed manually. It filled almost all of its commitment before being docked.",
      bandKind: "band",
      band: "2 487 – 2 513",
      bandNote: "USDC per ETH · ±0.50% band, fee on every fill",
      legs: [
        leg(usdc, 5_000_000_000n, 5_000_000_000n),
        leg(weth, 2_000000000000000000n, 1_982000000000000000n),
      ],
      fills: [
        fill(now - 3 * D, "+2 512.00 USDC  →  −0.9930 WETH"),
        fill(now - 5 * D, "+2 488.00 USDC  →  −0.9890 WETH"),
      ],
      deadline: now + 4 * D,
      dockedAt: now - 3 * D,
      risk: "low",
      // The fallback variant, so the sheet's provenance strip shows both.
      provenance: "TEMPLATE_FALLBACK",
      slots: slotRows({ bandBps: 5_000_000, feeBps: 500_000, deadline: now + 4 * D }),
    },
    {
      id: "demo-5",
      strategyHash:
        "0x91b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e1a2b" as Hex,
      pair: "DAI / USDC",
      templateLabel: label("banded-fee"),
      description:
        "Concentrates a hair-thin ±0.05% band around DAI/USDC parity, earning a 0.01% fee on the stable-to-stable flow. Small edge, very high fill rate.",
      bandKind: "band",
      band: "0.9995 – 1.0005",
      bandNote: "USDC per DAI · ±0.05% band, stable pair",
      legs: [
        leg(DAI, 20_000_000000000000000000n, 7_312_450000000000000000n),
        leg(usdc, 20_000_000_000n, 6_988_120_000n),
      ],
      fills: [
        fill(now - 3 * H, "+2 501.10 DAI  →  −2 500.72 USDC"),
        fill(now - 11 * H, "−1 812.00 DAI  →  +1 812.35 USDC"),
      ],
      deadline: now + 3 * D + 6 * H,
      dockedAt: null,
      risk: "low",
      provenance: "ENCLAVE",
      slots: slotRows({ bandBps: 500_000, feeBps: 100_000, deadline: now + 3 * D + 6 * H }),
    },
    {
      id: "demo-6",
      strategyHash:
        "0x3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70812c3d" as Hex,
      pair: "AAVE / WETH",
      templateLabel: label("banded"),
      description:
        "Holds a wide ±22% band on AAVE against WETH, waiting for volatility to come to it. Fills rarely and holds a large commitment while it waits.",
      bandKind: "band",
      band: "0.052 – 0.081",
      bandNote: "WETH per AAVE · ±22.00% band, patient",
      legs: [
        leg(AAVE, 150_000000000000000000n, 12_400000000000000000n),
        leg(weth, 6_000000000000000000n, 0n),
      ],
      fills: [fill(now - 2 * D, "+12.4000 AAVE  →  −0.8140 WETH")],
      deadline: now + 6 * D,
      dockedAt: null,
      risk: "medium",
      provenance: "ENCLAVE",
      slots: slotRows({ bandBps: 220_000_000, deadline: now + 6 * D }),
    },
    {
      id: "demo-7",
      strategyHash:
        "0x5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b23e4f" as Hex,
      pair: "USDT / USDC",
      templateLabel: label("banded-fee"),
      description:
        "Quoted the USDT/USDC parity band and was closed manually after a depeg scare. Most of its commitment was still unconsumed when it was docked.",
      bandKind: "band",
      band: "0.9990 – 1.0010",
      bandNote: "USDC per USDT · ±0.10% band, stable pair",
      legs: [
        leg(USDT, 15_000_000_000n, 2_104_330_000n),
        leg(usdc, 15_000_000_000n, 1_998_010_000n),
      ],
      fills: [fill(now - 6 * D, "+2 104.33 USDT  →  −2 103.90 USDC")],
      deadline: now + 2 * D,
      dockedAt: now - 5 * D,
      risk: "low",
      provenance: "ENCLAVE",
      slots: slotRows({ bandBps: 1_000_000, feeBps: 100_000, deadline: now + 2 * D }),
    },
    {
      id: "demo-8",
      strategyHash:
        "0x819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e4f50" as Hex,
      pair: "UNI / USDC",
      templateLabel: label("full-range"),
      description:
        "Makes a market on UNI against USDC across the whole curve — no band, no fee. The entire commitment is exposed to wherever the price goes, and is rated high for exactly that reason.",
      bandKind: "band",
      band: "full range",
      bandNote: "USDC per UNI · whole curve, no concentration",
      legs: [
        leg(UNI, 400_000000000000000000n, 0n),
        leg(usdc, 5_000_000_000n, 0n),
      ],
      fills: [],
      deadline: now + 4 * D + 8 * H,
      dockedAt: null,
      risk: "high",
      provenance: "ENCLAVE",
      slots: slotRows({ deadline: now + 4 * D + 8 * H }),
    },
  ];
}

// bandBps/feeBps are out of 1e9 (FEE_BPS_ONE) — see config/opcodes.8453.json.
const BPS_ONE = 1_000_000_000;
const pct = (bps: number) => `${((bps / BPS_ONE) * 100).toFixed(2)}%`;

/**
 * The same four rows, in the same order and wording `from-server.ts` builds for
 * a real recommendation — a demo sheet must not render a slot assignment the
 * real path never would.
 */
function slotRows(opts: { bandBps?: number; feeBps?: number; deadline: number }) {
  return [
    {
      index: 1,
      name: "curve",
      instruction: "XYC_SWAP_XD",
      params: "constant-product amount computation",
    },
    {
      index: 2,
      name: "band",
      instruction: opts.bandBps !== undefined ? "XYC_CONCENTRATE_GROW_LIQUIDITY_2D" : "— not used",
      params:
        opts.bandBps !== undefined
          ? `±${pct(opts.bandBps)} around mid at observation`
          : "full range",
    },
    {
      index: 3,
      name: "fee",
      instruction: opts.feeBps !== undefined ? "FLAT_FEE_AMOUNT_IN_XD" : "— not used",
      params:
        opts.feeBps !== undefined ? `${pct(opts.feeBps)} on amount in` : "no maker fee",
    },
    {
      index: 4,
      name: "deadline",
      instruction: "DEADLINE",
      params: `${opts.deadline} · ${formatDeadlineAbs(opts.deadline).replace(" · ", " ").replace(" UTC", "Z")}`,
    },
  ];
}

/** "Jul 25 · 09:12" — same shape the subgraph's fills will render as. */
function fill(unix: number, flow: string) {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    time: `${formatDayShort(unix)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    flow,
  };
}
