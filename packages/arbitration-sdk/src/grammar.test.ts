import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEADLINE,
	BAND,
	WRAPPERS,
	CURVES,
	OMITTED,
	COMPILER_EMITTED,
	TEMPLATES,
	CURVE_OPTIONS,
	COMPAT_RULES,
	grammarPromptBlock,
	unknownInstructions,
	type Template,
} from "./grammar.ts";
import { OP, isRealOpcode } from "./opcodes.ts";
import { fullRange, fullRangeWithFee, banded, bandedWithFee, decodeProgram } from "./swapvm.ts";

// The property that makes this file trustworthy: the menu cannot name anything
// the venue does not dispatch. The old grammar offered _limitSwap1D, three
// invalidators and an oracle adjuster, none of which have an opcode — so the
// model produced well-formed JSON describing an unbuildable strategy.
test("every instruction named anywhere in the grammar exists in the pinned table", () => {
	assert.deepEqual(unknownInstructions(), []);
});

test("every offered instruction is dispatchable, not a silent no-op", () => {
	for (const i of [DEADLINE, BAND, ...WRAPPERS, ...CURVES]) {
		assert.equal(i.opcode, OP[i.name], `${i.name}: opcode does not match the pinned table`);
		assert.ok(isRealOpcode(i.opcode), `${i.name}: 0x${i.opcode.toString(16)} is not dispatchable`);
	}
});

test("the instructions that no longer exist are gone from the menu", () => {
	// Named explicitly so a future edit that reintroduces them fails loudly
	// rather than quietly producing strategies that cannot be compiled.
	const removed = [
		"_limitSwap1D",
		"_limitSwapOnlyFull1D",
		"_invalidateTokenIn1D",
		"_invalidateTokenOut1D",
		"_invalidateBit1D",
		"_oraclePriceAdjuster1D",
		"_dynamicBalancesXD",
		"_staticBalancesXD",
	];
	const menu = grammarPromptBlock();
	for (const name of removed) {
		assert.ok(!menu.includes(name), `${name} is back in the prompt menu — it has no opcode on this router`);
	}
});

test("the taker gates are not offered while swapvm.ts has no encoder for them", () => {
	// Offering the model an instruction our own compiler cannot emit is the
	// grammar-drift bug one layer down: it passes every menu check and fails at
	// compile time. They live in OMITTED until an encoder exists.
	for (const name of ["ONLY_TAKER_TOKEN_BALANCE_NON_ZERO", "ONLY_TAKER_TOKEN_BALANCE_GTE"]) {
		assert.ok(name in OMITTED, `${name}: not in OMITTED`);
		assert.ok(!grammarPromptBlock().includes(name), `${name} is on the menu but has no encoder`);
	}
});

// A template is IN the grammar only if these bytes can be produced today. This
// mapping is the test's own — if a template is added without extending it, the
// test throws, which is the point.
function compileTemplate(t: Template): Uint8Array {
	const base = { salt: 1n, deadline: 1_800_000_000 };
	// The banded templates need tokens and amounts — the deltas derive from them.
	const bandedBase = {
		...base,
		bandBps: 10_000_000,
		tokens: [
			"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
			"0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
		] as [string, string],
		amounts: [10_000_000_000n, 10_000_000_000_000_000_000_000n] as [bigint, bigint],
	};
	switch (t.id) {
		case "full-range":
			return fullRange(base);
		case "full-range-fee":
			return fullRangeWithFee({ ...base, feeBps: 500_000 });
		case "banded":
			return banded(bandedBase);
		case "banded-fee":
			return bandedWithFee({ ...bandedBase, feeBps: 500_000 });
		default:
			throw new Error(`template ${t.id} has no compile mapping — add one or remove the template`);
	}
}

test("every template actually compiles, with exactly one curve, last", () => {
	for (const t of TEMPLATES) {
		const program = compileTemplate(t);
		const decoded = decodeProgram(program);

		const curves = decoded.filter((i) => CURVES.some((c) => c.opcode === i.opcode));
		assert.equal(curves.length, 1, `${t.id}: expected exactly one curve instruction`);
		assert.equal(
			decoded.at(-1)?.opcode,
			OP[t.curve],
			`${t.id}: the curve must be the LAST instruction — the VM reverts a wrapper placed after it`,
		);
		for (const ins of decoded) {
			assert.ok(isRealOpcode(ins.opcode), `${t.id}: 0x${ins.opcode.toString(16)} is not dispatchable`);
		}
		// The declared wrappers are really in the bytes.
		for (const w of t.wrappers) {
			assert.ok(
				decoded.some((i) => i.opcode === OP[w]),
				`${t.id}: declared wrapper ${w} is missing from the compiled program`,
			);
		}
	}
});

test("omitted instructions are real opcodes on this router", () => {
	for (const name of Object.keys(OMITTED)) {
		assert.ok(OP[name] !== undefined, `${name} is omitted but is not in the table at all`);
	}
});

test("the menu and the omitted list do not overlap", () => {
	for (const i of [DEADLINE, BAND, ...WRAPPERS, ...CURVES]) {
		assert.ok(!(i.name in OMITTED), `${i.name} is both offered and omitted`);
	}
});

test("salt is compiler-emitted, never offered to the model", () => {
	assert.ok(COMPILER_EMITTED.includes("SALT"));
	assert.ok(
		![DEADLINE, BAND, ...WRAPPERS, ...CURVES].some((i) => i.name === "SALT"),
		"SALT must not be a model choice",
	);
	assert.match(grammarPromptBlock(), /do NOT choose a salt/);
});

test("the band is on the menu and the model chooses bandBps, never deltas", () => {
	const menu = grammarPromptBlock();
	assert.ok(menu.includes("XYC_CONCENTRATE_GROW_LIQUIDITY_2D"), "band missing from the menu");
	assert.match(COMPAT_RULES.join(" "), /never emit deltas/);
	// The one silent error the band shares with the fee: the 1e9 base.
	assert.match(BAND.params ?? "", /1000000000/);
});

test("the prompt block states the ordering rules the VM actually enforces", () => {
	const rules = COMPAT_RULES.join(" ");
	assert.match(rules, /[Ee]xactly one curve/);
	assert.match(rules, /BEFORE the curve/);
	assert.match(rules, /PER TOKEN/);
	// The fee basis is the single most likely silent error: 1e9, not 1e4.
	assert.match(rules, /1000000000/);
});

test("every template's curve is on the menu", () => {
	for (const t of TEMPLATES) {
		assert.ok(CURVE_OPTIONS.includes(t.curve), `${t.id}: curve ${t.curve} is not on the menu`);
	}
});
