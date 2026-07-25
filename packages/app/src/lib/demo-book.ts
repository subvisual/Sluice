import type { Hex } from "viem";
import type { Position } from "./book";
import { TOKENS } from "./tokens";
import { formatDayShort, formatDeadlineAbs } from "./time";

/**
 * ⚠️ DEMO fixtures — the four positions from the design prototype
 * (`docs/design_handoff_sluice_redesign`), covering every card and sheet
 * state: live, live-near-deadline, expired with no risk rating, and docked.
 *
 * Seeded by the "Show demo positions" button in the dashboard's empty state.
 * The handoff had dropped that affordance; it was reinstated deliberately so
 * every screen can be shown without waiting on the real book (F3). Deadlines
 * and fill times are derived from "now" so each fixture stays in its intended
 * state whenever it is loaded. Nothing here is, or claims to be, on-chain.
 */
/**
 * Demo-only tokens, deliberately NOT in `config/addresses.8453.json` — that
 * file is the product's supported-token list and feeds the budget picker.
 * These exist only so fixture positions show pair variety. Base addresses
 * where the token is deployed there (USDT, DAI); canonical mainnet addresses
 * for AAVE/UNI, whose art the icon lookup finds via its `ethereum` fallback.
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
      templateLabel: "tight-clmm — flow capture",
      description:
        "Quotes both sides of a narrow band around 2 460 USDC per ETH, earning fees on the flow that crosses it. Fills a little at a time; it does not take a view on direction.",
      bandKind: "band",
      band: "2 400 – 2 520",
      bandNote: "USDC per ETH · narrow band, partial fills",
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
      slots: [
        slot(1, "balance setup", "per-token setup", "USDC 12 000.000000 · WETH 4.000000000000000000"),
        slot(2, "fees", "fee configuration", "5 bps"),
        slot(3, "swap logic", "_xycConcentrateGrowLiquidityXD", "band 2 400 – 2 520 · 2 dims"),
        slot(4, "oracle adjust", "— not used", "no feed required"),
        slot(5, "invalidation", "_invalidateTokenIn1D", "required for partial fills"),
        deadlineSlot(now + 5 * D + 12 * H),
      ],
    },
    {
      id: "demo-2",
      strategyHash:
        "0x2b90e3a1f7c8d6b5a4938271605f4e3d2c1b0a9988776655d417c3b2a1908d41" as Hex,
      pair: "WETH / USDC",
      templateLabel: "oracle-limit — a level, not a range",
      description:
        "Sells 2.5 WETH all at once if the oracle price reaches 2 600 USDC per ETH. All-or-nothing: it either does not fill, or it draws the whole amount in a single fill.",
      bandKind: "level",
      band: "sells at 2 600",
      bandNote: "USDC per ETH · all-or-nothing, oracle-adjusted",
      legs: [leg(weth, 2_500000000000000000n, 0n)],
      fills: [],
      deadline: now + 18 * H,
      dockedAt: null,
      risk: "medium",
      provenance: "ENCLAVE",
      slots: [
        slot(1, "balance setup", "per-token setup", "WETH 2.500000000000000000"),
        slot(2, "fees", "— not used", "no fee tier on a limit level"),
        slot(3, "swap logic", "_limitSwapOnlyFull1D", "level 2 600 · full only"),
        slot(4, "oracle adjust", "_oraclePriceAdjuster1D", "ETH/USD feed · 60s heartbeat"),
        slot(5, "invalidation", "_invalidateBit1D", "single-use bit 0x11"),
        deadlineSlot(now + 18 * H),
      ],
    },
    {
      id: "demo-3",
      strategyHash:
        "0xa10c99887766554433221100ffeeddccbbaa5b2299887766554433221100fedc" as Hex,
      pair: "WETH / USDC",
      templateLabel: "wide-clmm — patient liquidity",
      description:
        "Held a wide band around 2 500 USDC per ETH, waiting for the price to come to it. It expired with most of its commitment untouched and has unwound automatically.",
      bandKind: "band",
      band: "2 180 – 2 820",
      bandNote: "USDC per ETH · wide band, patient",
      legs: [leg(usdc, 8_000_000_000n, 1_210_400_000n)],
      fills: [fill(now - 4 * D, "+1 210.40 USDC  →  −0.4820 WETH")],
      deadline: now - 2 * D,
      dockedAt: null,
      // Absent on purpose: the card must say "risk rating unavailable".
      risk: null,
      provenance: "ENCLAVE",
      slots: [
        slot(1, "balance setup", "per-token setup", "USDC 8 000.000000"),
        slot(2, "fees", "fee configuration", "30 bps"),
        slot(3, "swap logic", "_xycConcentrateGrowLiquidityXD", "band 2 180 – 2 820 · 2 dims"),
        slot(4, "oracle adjust", "— not used", "no feed required"),
        slot(5, "invalidation", "_invalidateTokenIn1D", "required for partial fills"),
        deadlineSlot(now - 2 * D),
      ],
    },
    {
      id: "demo-4",
      strategyHash:
        "0x55e7d4c3b2a190887766554433221100aabbccddeeff00112233445566770a91" as Hex,
      pair: "WETH / USDC",
      templateLabel: "tight-clmm — flow capture",
      description:
        "A narrow-band flow-capture strategy you closed manually. It filled almost all of its commitment before being docked.",
      bandKind: "band",
      band: "2 440 – 2 560",
      bandNote: "USDC per ETH · narrow band, partial fills",
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
      slots: [
        slot(1, "balance setup", "per-token setup", "USDC 5 000.000000 · WETH 2.000000000000000000"),
        slot(2, "fees", "fee configuration", "5 bps"),
        slot(3, "swap logic", "_xycConcentrateGrowLiquidityXD", "band 2 440 – 2 560 · 2 dims"),
        slot(4, "oracle adjust", "— not used", "no feed required"),
        slot(5, "invalidation", "_invalidateTokenIn1D", "required for partial fills"),
        deadlineSlot(now + 4 * D),
      ],
    },
    {
      id: "demo-5",
      strategyHash:
        "0x91b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e1a2b" as Hex,
      pair: "DAI / USDC",
      templateLabel: "tight-clmm — flow capture",
      description:
        "Quotes a hair-thin band around parity between DAI and USDC, earning the stable-to-stable flow. Small edge, very high fill rate.",
      bandKind: "band",
      band: "0.9995 – 1.0005",
      bandNote: "USDC per DAI · stable pair, partial fills",
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
      slots: [
        slot(1, "balance setup", "per-token setup", "DAI 20 000.000000000000000000 · USDC 20 000.000000"),
        slot(2, "fees", "fee configuration", "1 bps"),
        slot(3, "swap logic", "_xycConcentrateGrowLiquidityXD", "band 0.9995 – 1.0005 · 2 dims"),
        slot(4, "oracle adjust", "— not used", "no feed required"),
        slot(5, "invalidation", "_invalidateTokenIn1D", "required for partial fills"),
        deadlineSlot(now + 3 * D + 6 * H),
      ],
    },
    {
      id: "demo-6",
      strategyHash:
        "0x3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70812c3d" as Hex,
      pair: "AAVE / WETH",
      templateLabel: "wide-clmm — patient liquidity",
      description:
        "Holds a wide band on AAVE against WETH, waiting for volatility to come to it. Fills rarely and holds a large commitment while it waits.",
      bandKind: "band",
      band: "0.052 – 0.081",
      bandNote: "WETH per AAVE · wide band, patient",
      legs: [
        leg(AAVE, 150_000000000000000000n, 12_400000000000000000n),
        leg(weth, 6_000000000000000000n, 0n),
      ],
      fills: [fill(now - 2 * D, "+12.4000 AAVE  →  −0.8140 WETH")],
      deadline: now + 6 * D,
      dockedAt: null,
      risk: "medium",
      provenance: "ENCLAVE",
      slots: [
        slot(1, "balance setup", "per-token setup", "AAVE 150.000000000000000000 · WETH 6.000000000000000000"),
        slot(2, "fees", "fee configuration", "30 bps"),
        slot(3, "swap logic", "_xycConcentrateGrowLiquidityXD", "band 0.052 – 0.081 · 2 dims"),
        slot(4, "oracle adjust", "— not used", "no feed required"),
        slot(5, "invalidation", "_invalidateTokenIn1D", "required for partial fills"),
        deadlineSlot(now + 6 * D),
      ],
    },
    {
      id: "demo-7",
      strategyHash:
        "0x5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b23e4f" as Hex,
      pair: "USDT / USDC",
      templateLabel: "tight-clmm — flow capture",
      description:
        "Quoted the USDT/USDC parity band and was closed manually after a depeg scare. Most of its commitment was still unconsumed when it was docked.",
      bandKind: "band",
      band: "0.9990 – 1.0010",
      bandNote: "USDC per USDT · stable pair, partial fills",
      legs: [
        leg(USDT, 15_000_000_000n, 2_104_330_000n),
        leg(usdc, 15_000_000_000n, 1_998_010_000n),
      ],
      fills: [fill(now - 6 * D, "+2 104.33 USDT  →  −2 103.90 USDC")],
      deadline: now + 2 * D,
      dockedAt: now - 5 * D,
      risk: "low",
      provenance: "ENCLAVE",
      slots: [
        slot(1, "balance setup", "per-token setup", "USDT 15 000.000000 · USDC 15 000.000000"),
        slot(2, "fees", "fee configuration", "1 bps"),
        slot(3, "swap logic", "_xycConcentrateGrowLiquidityXD", "band 0.9990 – 1.0010 · 2 dims"),
        slot(4, "oracle adjust", "— not used", "no feed required"),
        slot(5, "invalidation", "_invalidateTokenIn1D", "required for partial fills"),
        deadlineSlot(now + 2 * D),
      ],
    },
    {
      id: "demo-8",
      strategyHash:
        "0x819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e4f50" as Hex,
      pair: "UNI / USDC",
      templateLabel: "oracle-limit — a level, not a range",
      description:
        "Sells 400 UNI all at once if the oracle price reaches 12.40 USDC. All-or-nothing: it either does not fill, or it draws the whole amount in a single fill.",
      bandKind: "level",
      band: "sells at 12.40",
      bandNote: "USDC per UNI · all-or-nothing, oracle-adjusted",
      legs: [leg(UNI, 400_000000000000000000n, 0n)],
      fills: [],
      deadline: now + 4 * D + 8 * H,
      dockedAt: null,
      risk: "high",
      provenance: "ENCLAVE",
      slots: [
        slot(1, "balance setup", "per-token setup", "UNI 400.000000000000000000"),
        slot(2, "fees", "— not used", "no fee tier on a limit level"),
        slot(3, "swap logic", "_limitSwapOnlyFull1D", "level 12.40 · full only"),
        slot(4, "oracle adjust", "_oraclePriceAdjuster1D", "UNI/USD feed · 60s heartbeat"),
        slot(5, "invalidation", "_invalidateBit1D", "single-use bit 0x2f"),
        deadlineSlot(now + 4 * D + 8 * H),
      ],
    },
  ];
}

const slot = (
  index: number,
  name: string,
  instruction: string,
  params: string,
) => ({ index, name, instruction, params });

const deadlineSlot = (unix: number) =>
  slot(
    6,
    "deadline",
    "_deadline",
    `${unix} · ${formatDeadlineAbs(unix).replace(" · ", " ").replace(" UTC", "Z")}`,
  );

/** "Jul 25 · 09:12" — same shape the subgraph's fills will render as. */
function fill(unix: number, flow: string) {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    time: `${formatDayShort(unix)} · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    flow,
  };
}
