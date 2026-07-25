import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFixtures, readFixtures } from "./fixtures.ts";
import { fullRange, aquaOrder, shipBytes, strategyHash, toHex, fromHex, decodeProgram } from "./swapvm.ts";
import { isRealOpcode, SWAPVM_ROUTER_VERSION } from "./opcodes.ts";

// The contracts ship these exact bytes. If this file drifts from the generator,
// Foundry is testing something the composer would never emit — which is the
// whole failure mode having one encoder is meant to remove.
test("the checked-in fixture matches what the encoder produces now", () => {
	assert.deepEqual(
		readFixtures(),
		buildFixtures(),
		"config/fixtures/strategies.json is stale — run `npm run fixtures`",
	);
});

test("fixtures were generated against the deployed router version we pinned", () => {
	assert.equal(readFixtures().routerVersion, SWAPVM_ROUTER_VERSION);
});

test("every fixture rebuilds byte-for-byte from its recorded inputs", () => {
	for (const f of readFixtures().strategies) {
		const order = aquaOrder(
			f.inputs.maker,
			fullRange({ salt: BigInt(f.inputs.salt), deadline: f.inputs.deadline }),
		);
		assert.equal(toHex(order.program), f.outputs.program, `${f.name}: program`);
		assert.equal(toHex(shipBytes(order)), f.outputs.strategy, `${f.name}: strategy`);
		assert.equal(strategyHash(order), f.outputs.strategyHash, `${f.name}: strategyHash`);
	}
});

test("no fixture emits into the silent no-op region or past the dispatch array", () => {
	for (const f of readFixtures().strategies) {
		for (const ins of decodeProgram(fromHex(f.outputs.program))) {
			assert.ok(isRealOpcode(ins.opcode), `${f.name}: 0x${ins.opcode.toString(16)} is not dispatchable`);
		}
	}
});

test("the strategy really is abi.encode(order), not the bare program", () => {
	// Aqua stores keccak256(strategy) and the router computes
	// keccak256(abi.encode(order)) in Aqua mode. Shipping the program alone would
	// key the balances to a hash no swap can reach — and it would not revert until
	// somebody tried to fill.
	for (const f of readFixtures().strategies) {
		assert.notEqual(f.outputs.strategy, f.outputs.program);
		assert.ok(f.outputs.strategy.length > f.outputs.program.length);
	}
});

test("token and amount arrays line up", () => {
	for (const f of readFixtures().strategies) {
		assert.equal(f.inputs.tokens.length, f.inputs.amounts.length, `${f.name}: tokens/amounts length`);
		for (const a of f.inputs.amounts) {
			// Decimal strings, never JS numbers — a bigint through JSON.stringify is a
			// silent correctness bug.
			assert.match(a, /^[0-9]+$/, `${f.name}: amount is not a decimal string`);
			assert.notEqual(BigInt(a), 0n, `${f.name}: zero amount`);
		}
	}
});
