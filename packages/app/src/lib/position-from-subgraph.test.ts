import { test } from "node:test";
import assert from "node:assert/strict";
import type { MakerPosition } from "@sluice/arbitration-sdk/subgraph";
import {
  aquaOrder,
  bandedWithFee,
  fullRange,
  shipBytes,
  toHex,
} from "@sluice/arbitration-sdk/swapvm";
import { formatFixed } from "./amount";
import { toPositionDto } from "./position-from-subgraph";
import { revivePosition } from "./position-dto";

/**
 * The read-back path: subgraph row (with REAL compiler-emitted strategy
 * bytes) → PositionDto → Position. The bytes are built by the same module
 * that ships them, so what this test decodes is what the chain stores.
 */

const MAKER = "0x6878d79f988e7ecb537016b93bb77b4d680e1f01";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";
const DEADLINE = 1_800_000_000;

function row(strategyData: string, overrides: Partial<MakerPosition> = {}): MakerPosition {
  return {
    id: "0xrow1",
    strategyHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    status: "LIVE",
    strategyData,
    shippedAt: 1_750_000_000,
    dockedAt: null,
    balances: [
      {
        tokenAddress: USDC,
        symbol: "USDC",
        decimals: 6,
        initialVirtual: "5000000000",
        virtualBalance: "3795500000",
        totalPulled: "1204500000",
        totalPushed: "0",
      },
      {
        tokenAddress: WETH,
        symbol: "WETH",
        decimals: 18,
        initialVirtual: "2000000000000000000",
        virtualBalance: "2000000000000000000",
        totalPulled: "0",
        totalPushed: "0",
      },
    ],
    fills: [
      {
        ts: 1_750_001_000,
        tokenInSymbol: "USDC",
        tokenInDecimals: 6,
        amountIn: "1204500000",
        tokenOutSymbol: "WETH",
        tokenOutDecimals: 18,
        amountOut: "490000000000000000",
      },
    ],
    ...overrides,
  };
}

const fullRangeData = toHex(
  shipBytes(aquaOrder(MAKER, fullRange({ salt: 7n, deadline: DEADLINE }))),
);

test("a full-range program reads back with its template and deadline", () => {
  const dto = toPositionDto(row(fullRangeData));
  assert.equal(dto.templateLabel, "market-make the whole curve");
  assert.equal(dto.deadline, DEADLINE);
  assert.equal(dto.band, "full range");
  assert.equal(dto.risk, null);
  assert.equal(dto.provenance, null);
  assert.deepEqual(
    dto.slots.map((s) => s.instruction),
    ["SALT", "DEADLINE", "XYC_SWAP_XD"],
  );
});

test("legs carry the shipped ceiling and the pulled amount, pair sorts by decimals", () => {
  const position = revivePosition(toPositionDto(row(fullRangeData)));
  assert.equal(position.pair, "WETH / USDC");
  const usdc = position.legs.find((l) => l.symbol === "USDC")!;
  assert.equal(usdc.virtual, 5000000000n);
  assert.equal(usdc.consumed, 1204500000n);
});

test("fills render as maker flow with a UTC timestamp", () => {
  const [fill] = toPositionDto(row(fullRangeData)).fills;
  // formatFixed groups thousands with a no-break space — compare through it.
  assert.equal(
    fill.flow,
    `+${formatFixed(1204500000n, 6, 2)} USDC  →  −${formatFixed(490000000000000000n, 18, 4)} WETH`,
  );
  assert.match(fill.time, /^Jun 15 · \d{2}:\d{2}$/);
});

test("a banded-fee program matches its template sequence", () => {
  const program = bandedWithFee({
    salt: 9n,
    deadline: DEADLINE,
    bandBps: 150_000_000,
    feeBps: 3_000_000,
    tokens: [WETH, USDC],
    amounts: [2_000_000_000_000_000_000n, 5_000_000_000n],
  });
  const dto = toPositionDto(row(toHex(shipBytes(aquaOrder(MAKER, program)))));
  assert.equal(dto.templateLabel, "banded + maker fee");
  assert.equal(dto.band, "banded");
  const fee = dto.slots.find((s) => s.name === "fee")!;
  assert.equal(fee.params, "0.30% on amount in");
});

test("undecodable strategy bytes still yield a position, honestly labelled", () => {
  const dto = toPositionDto(row("0x010203", { dockedAt: 1_750_100_000 }));
  assert.equal(dto.templateLabel, "on-chain program");
  assert.equal(dto.deadline, null);
  assert.equal(dto.dockedAt, 1_750_100_000);
  // The real amounts survive even when the program does not decode.
  assert.equal(dto.legs.length, 2);
});

test("docked rows compute consumed from net pulls, not the dock-zeroed balance", () => {
  const dto = toPositionDto(
    row(fullRangeData, {
      status: "DOCKED",
      dockedAt: 1_750_100_000,
      balances: [
        {
          tokenAddress: USDC,
          symbol: "USDC",
          decimals: 6,
          initialVirtual: "5000000000",
          // Zeroed by the dock refund — reading consumed from it would
          // falsely show the whole ceiling as spent.
          virtualBalance: "0",
          totalPulled: "1500000000",
          totalPushed: "300000000",
        },
      ],
      fills: [],
    }),
  );
  assert.equal(dto.legs[0].consumed, "1200000000");
  assert.equal(dto.dockedAt, 1_750_100_000);
});
