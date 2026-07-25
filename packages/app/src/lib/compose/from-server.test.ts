import test from "node:test";
import assert from "node:assert/strict";
import { fromServer } from "./from-server";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEADLINE = 2_000_000_000;

const SERVER_RESULT = {
  source: "TEMPLATE_FALLBACK" as const,
  reason: "ZG_PRIVATE_KEY is not configured — deterministic template seed; nothing was sent to 0G",
  recommendation: {
    schema: "sluice.recommendation/1" as const,
    chainId: 8453,
    observedAt: 1_999_999_000,
    observedBlock: 22_500_000,
    strategies: [
      {
        templateId: "banded-fee",
        slots: {
          curve: { instruction: "XYC_SWAP_XD" },
          band: {
            instruction: "XYC_CONCENTRATE_GROW_LIQUIDITY_2D",
            params: { bandBps: 10_000_000 },
          },
          fee: { instruction: "FLAT_FEE_AMOUNT_IN_XD", params: { feeBps: 500_000 } },
          deadline: { deadline: DEADLINE },
        },
        tokens: [WETH, USDC],
        virtualAmounts: ["2.0", "3000.0"],
      },
    ],
  },
  messages: null,
  proof: null,
  validation: { ok: true, violations: [] },
  attempts: 0,
};

test("fromServer maps a recommendation into the UI shapes", () => {
  const ui = fromServer(SERVER_RESULT, 1);

  assert.equal(ui.provenance, "TEMPLATE_FALLBACK");
  assert.match(ui.reason ?? "", /ZG_PRIVATE_KEY/);
  assert.equal(ui.nonce, 1);
  assert.equal(ui.strategies.length, 1);

  const s = ui.strategies[0];
  // Label resolved from the SDK's own TEMPLATES, not a second copy.
  assert.match(s.templateLabel, /banded/i);
  // bandBps is out of 1e9: 10_000_000 → ±1.00%.
  assert.equal(s.band, "±1.00%");
  assert.equal(s.bandKind, "band");
  // Legs carry exact base units: "2.0" WETH → 2n * 10n ** 18n.
  assert.equal(s.legs.length, 2);
  assert.equal(s.legs[0].token.symbol, "WETH");
  assert.equal(s.legs[0].virtual, 2n * 10n ** 18n);
  assert.equal(s.legs[1].virtual, 3000n * 10n ** 6n);
  assert.equal(s.deadline, DEADLINE);
  // Slot rows: curve + band + fee + deadline are all present and labelled.
  const names = s.slots.map((r) => r.name);
  for (const n of ["curve", "band", "fee", "deadline"]) assert.ok(names.includes(n), n);
  // Fee fact: 500_000 / 1e9 → 0.05%.
  assert.ok(s.facts.some((f) => f.value.includes("0.05%")));
});

test("fromServer truncates a virtualAmount with more fraction digits than the token has", () => {
  const overPrecise = {
    ...SERVER_RESULT,
    recommendation: {
      ...SERVER_RESULT.recommendation,
      strategies: [
        {
          ...SERVER_RESULT.recommendation.strategies[0],
          tokens: [WETH, USDC],
          // USDC has 6 decimals; the model emitted 7 fraction digits.
          virtualAmounts: ["2.0", "1000.3333333"],
        },
      ],
    },
  };
  const ui = fromServer(overPrecise, 1);
  // The leg survives — truncated to 6 dp, never dropped and never rounded up.
  assert.equal(ui.strategies[0].legs.length, 2);
  assert.equal(ui.strategies[0].legs[1].token.symbol, "USDC");
  assert.equal(ui.strategies[0].legs[1].virtual, 1000333333n);
});

test("fromServer drops legs for tokens outside the app token list", () => {
  const alien = {
    ...SERVER_RESULT,
    recommendation: {
      ...SERVER_RESULT.recommendation,
      strategies: [
        {
          ...SERVER_RESULT.recommendation.strategies[0],
          tokens: [WETH, "0x000000000000000000000000000000000000dEaD"],
          virtualAmounts: ["2.0", "5.0"],
        },
      ],
    },
  };
  const ui = fromServer(alien, 1);
  // The unknown token cannot be rendered (no decimals/symbol) — the leg is
  // dropped; the validator's I1 violation is what reports it to the user.
  assert.equal(ui.strategies[0].legs.length, 1);
  assert.equal(ui.strategies[0].legs[0].token.symbol, "WETH");
});
