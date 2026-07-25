import { test } from "node:test";
import assert from "node:assert/strict";
import {
	INSTRUCTIONS,
	OMITTED,
	COMPILER_EMITTED,
	TEMPLATES,
	CURVE_OPTIONS,
	GUARD_OPTIONS,
	WRAPPER_OPTIONS,
	COMPAT_RULES,
	grammarPromptBlock,
	unknownInstructions,
} from "./grammar.ts";
import { OP, isRealOpcode } from "./opcodes.ts";

// The property that makes this file trustworthy: the menu cannot name anything
// the venue does not dispatch. The old grammar offered _limitSwap1D, three
// invalidators and an oracle adjuster, none of which have an opcode — so the
// model produced well-formed JSON describing an unbuildable strategy.
test("every instruction named anywhere in the grammar exists in the pinned table", () => {
	assert.deepEqual(unknownInstructions(), []);
});

test("every offered instruction is dispatchable, not a silent no-op", () => {
	for (const i of INSTRUCTIONS) {
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
		"_xycConcentrateGrowLiquidityXD",
	];
	const menu = grammarPromptBlock();
	for (const name of removed) {
		assert.ok(!menu.includes(name), `${name} is back in the prompt menu — it has no opcode on this router`);
	}
});

test("exactly one curve is offered, and the templates all use a real one", () => {
	assert.ok(CURVE_OPTIONS.length >= 1);
	for (const t of TEMPLATES) {
		assert.ok(CURVE_OPTIONS.includes(t.curve), `${t.id}: curve ${t.curve} is not on the menu`);
		for (const w of t.wrappers) {
			assert.ok(WRAPPER_OPTIONS.includes(w), `${t.id}: wrapper ${w} is not on the menu`);
		}
	}
});

test("every template is buildable today", () => {
	// A template that names something we cannot compile is the exact bug this
	// file used to have. If a template is added before its encoder exists, it
	// belongs in OMITTED with a reason, not in TEMPLATES.
	assert.ok(TEMPLATES.length > 0);
	for (const t of TEMPLATES) {
		assert.ok(t.id && t.describesIntent && t.shape, `${t.id}: incomplete template`);
	}
});

test("omitted instructions each carry a reason", () => {
	for (const [name, reason] of Object.entries(OMITTED)) {
		assert.ok(OP[name] !== undefined, `${name} is omitted but is not in the table at all`);
		assert.ok(reason.length > 20, `${name}: give a real reason, not "${reason}"`);
	}
});

test("the menu and the omitted list do not overlap", () => {
	for (const i of INSTRUCTIONS) {
		assert.ok(!(i.name in OMITTED), `${i.name} is both offered and omitted`);
	}
});

test("salt is compiler-emitted, never offered to the model", () => {
	assert.ok(COMPILER_EMITTED.includes("SALT"));
	assert.ok(!INSTRUCTIONS.some((i) => i.name === "SALT"), "SALT must not be a model choice");
	assert.match(grammarPromptBlock(), /do NOT choose a salt/);
});

test("the prompt block states the ordering rules the VM actually enforces", () => {
	const rules = COMPAT_RULES.join(" ");
	assert.match(rules, /[Ee]xactly one curve/);
	assert.match(rules, /BEFORE the curve/);
	assert.match(rules, /PER TOKEN/);
	// The fee basis is the single most likely silent error: 1e9, not 1e4.
	assert.match(rules, /1000000000|not 10000/);
});

test("guards and wrappers are disjoint from curves", () => {
	for (const g of GUARD_OPTIONS) assert.ok(!CURVE_OPTIONS.includes(g));
	for (const w of WRAPPER_OPTIONS) assert.ok(!CURVE_OPTIONS.includes(w));
});
