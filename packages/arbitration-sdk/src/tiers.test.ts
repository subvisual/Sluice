import { test } from "node:test";
import assert from "node:assert/strict";
import { bandTiers, tiersPromptBlock } from "./tiers.ts";
import { FEE_BPS_ONE } from "./opcodes.ts";

const WEEK = 7 * 24 * 60 * 60;
const YEAR = 365 * 24 * 60 * 60;
const VOL = 58; // the stub pair's realised volatility, ANNUALISED percent

test("three tiers, strictly decreasing wide -> tight", () => {
	const t = bandTiers(VOL, WEEK, "neutral");
	assert.deepEqual(
		t.map((x) => x.tier),
		["wide", "mid", "tight"],
	);
	assert.ok(t[0].bandBps > t[1].bandBps, JSON.stringify(t));
	assert.ok(t[1].bandBps > t[2].bandBps, JSON.stringify(t));
});

test("every bandBps is an encodable integer in (0, FEE_BPS_ONE)", () => {
	for (const appetite of ["conservative", "neutral", "aggressive"] as const) {
		for (const vol of [0, 0.5, 58, 500, 100_000]) {
			for (const horizon of [60, 3600, WEEK, 30 * WEEK]) {
				for (const t of bandTiers(vol, horizon, appetite)) {
					assert.ok(Number.isInteger(t.bandBps), `${t.bandBps}`);
					assert.ok(t.bandBps > 0 && t.bandBps < FEE_BPS_ONE, `${t.bandBps}`);
				}
			}
		}
	}
});

test("appetite shifts the set tighter without changing the count", () => {
	// Below the clamp ceiling, every tier tightens strictly with appetite — the
	// "suggest 5/7/9 instead of 3/5/7" behaviour, expressed in band width.
	const conservative = bandTiers(5, WEEK, "conservative");
	const neutral = bandTiers(5, WEEK, "neutral");
	const aggressive = bandTiers(5, WEEK, "aggressive");

	assert.equal(aggressive.length, 3);
	for (let i = 0; i < 3; i++) {
		assert.ok(conservative[i].bandBps > neutral[i].bandBps, `tier ${i}`);
		assert.ok(neutral[i].bandBps > aggressive[i].bandBps, `tier ${i}`);
	}
});

test("appetite never LOOSENS a tier, even where the clamp flattens it", () => {
	// Under a volatility high enough to pin the widest bands to the encodable
	// ceiling they come out equal rather than ordered. That is honest — nothing
	// is wider than "wider than any move" — but appetite must never hand a
	// conservative user a TIGHTER band than a degen one.
	const c = bandTiers(400, WEEK, "conservative");
	const n = bandTiers(400, WEEK, "neutral");
	const a = bandTiers(400, WEEK, "aggressive");
	for (let i = 0; i < 3; i++) {
		assert.ok(c[i].bandBps >= n[i].bandBps, `tier ${i}`);
		assert.ok(n[i].bandBps >= a[i].bandBps, `tier ${i}`);
	}
	assert.equal(c[0].bandBps, n[0].bandBps); // both clamped — pinned deliberately
});

test("a shorter horizon gives tighter bands — vol is scaled by sqrt(time)", () => {
	const week = bandTiers(VOL, WEEK, "neutral");
	const day = bandTiers(VOL, 86_400, "neutral");
	for (let i = 0; i < 3; i++) assert.ok(day[i].bandBps < week[i].bandBps);
});

test("the neutral mid tier is the horizon-scaled volatility itself", () => {
	// 58% annualised over one week is 58 * sqrt(7/365) ≈ 8.03%, and the neutral
	// mid multiplier is 1 — so the mid tier IS the move the pair is expected to
	// make over the strategy's life. Sane market-making bands; the un-scaled
	// reading would put this at ±58%.
	const [, mid] = bandTiers(VOL, WEEK, "neutral");
	const expectedPct = VOL * Math.sqrt(WEEK / YEAR);
	assert.equal(mid.bandBps, Math.round((expectedPct / 100) * FEE_BPS_ONE));
	assert.ok(Number(mid.movePct) > 7 && Number(mid.movePct) < 9, mid.movePct);
});

test("the stub pair produces bands a market maker would actually ship", () => {
	// Guards the calibration decision in tiers.ts: if this starts asserting
	// ±87%/±99% again, the annualised reading has been lost and the tiers are
	// full-range in all but name.
	for (const t of bandTiers(VOL, WEEK, "neutral")) {
		assert.ok(Number(t.movePct) < 25, `${t.tier} at ±${t.movePct}% is not a band`);
	}
});

test("degenerate volatility still yields three usable, distinct tiers", () => {
	for (const vol of [0, -5, Number.NaN]) {
		const t = bandTiers(vol, WEEK, "neutral");
		assert.ok(t[0].bandBps > t[1].bandBps && t[1].bandBps > t[2].bandBps, `${vol}`);
		assert.ok(t[2].bandBps > 0, `${vol}`);
	}
});

test("extreme volatility clamps below the encodable ceiling and stays ordered", () => {
	const t = bandTiers(100_000, 30 * WEEK, "conservative");
	assert.ok(t[0].bandBps < FEE_BPS_ONE);
	assert.ok(t[0].bandBps > t[1].bandBps && t[1].bandBps > t[2].bandBps);
});

test("movePct is derived from bandBps, so label and number cannot disagree", () => {
	for (const t of bandTiers(VOL, WEEK, "aggressive")) {
		assert.equal(t.movePct, ((t.bandBps / FEE_BPS_ONE) * 100).toFixed(2));
	}
});

test("the block carries the integers, the stub label, and no yield claim", () => {
	const block = tiersPromptBlock(bandTiers(VOL, WEEK, "neutral"), {
		stubVol: true,
		maxStrategies: 3,
		hasPairing: true,
	});
	for (const t of bandTiers(VOL, WEEK, "neutral")) {
		assert.ok(block.includes(String(t.bandBps)), `${t.bandBps} missing`);
	}
	assert.ok(block.includes("STUB"), block);
	assert.ok(/do not invent one/i.test(block), block);
	assert.ok(/three strategies/i.test(block), block);
	// Mechanics, never yield: no projected-return language may appear here.
	// ("return" alone is the JSON instruction verb, not a yield claim.)
	assert.ok(!/\bAPR\b|\bexpected (return|yield)\b/i.test(block), block);
});

test("the stub label disappears once the volatility is real", () => {
	const block = tiersPromptBlock(bandTiers(VOL, WEEK, "neutral"), {
		stubVol: false,
		maxStrategies: 3,
		hasPairing: true,
	});
	assert.ok(!block.includes("STUB"), block);
});

test("with no pairing block, the task says DIVIDE instead of pointing at a block that is not there", () => {
	const block = tiersPromptBlock(bandTiers(VOL, WEEK, "neutral"), {
		stubVol: true,
		maxStrategies: 3,
		hasPairing: false,
	});
	// A dangling "take the amounts from REFERENCE PAIRING" is an invitation to
	// invent one when that block was omitted.
	assert.ok(!block.includes("REFERENCE PAIRING"), block);
	assert.ok(/DIVIDE the budget/.test(block), block);
});
