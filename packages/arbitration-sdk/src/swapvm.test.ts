import { test } from "node:test";
import assert from "node:assert/strict";
import {
	encodeInstruction,
	encodeProgram,
	decodeProgram,
	formatProgram,
	uintBytes,
	toHex,
	salt,
	deadline,
	xycSwap,
	fullRange,
	fullRangeWithFee,
} from "./swapvm.ts";
import { OP, isRealOpcode, FIRST_REAL_OPCODE, LAST_REAL_OPCODE } from "./opcodes.ts";

test("encodes [opcode][argsLength][args]", () => {
	const bytes = encodeInstruction({
		opcode: OP.DEADLINE,
		args: uintBytes(0x0102030405n, 5),
	});
	assert.equal(toHex(bytes), "0x0d050102030405");
});

test("an argument-free instruction encodes with a zero length byte", () => {
	assert.equal(toHex(encodeInstruction(xycSwap())), "0x1100");
});

test("refuses the silent no-op region", () => {
	// 0x00-0x09 do not revert on chain — they execute and do nothing. A program
	// carrying one would compute no amounts and still run to completion, so this
	// has to be caught here rather than by a failing transaction.
	for (const opcode of [0x00, 0x05, 0x09]) {
		assert.throws(
			() => encodeInstruction({ opcode, args: new Uint8Array(0) }),
			/not a dispatchable opcode/,
		);
	}
});

test("refuses opcodes past the end of the dispatch array", () => {
	assert.throws(
		() => encodeInstruction({ opcode: 0x1c, args: new Uint8Array(0) }),
		/not a dispatchable opcode/,
	);
});

test("refuses args longer than the single length byte can describe", () => {
	assert.throws(
		() => encodeInstruction({ opcode: OP.SALT, args: new Uint8Array(256) }),
		/args too long/,
	);
});

test("uintBytes is big-endian and width-checked", () => {
	assert.equal(toHex(uintBytes(1n, 5)), "0x0000000001");
	assert.throws(() => uintBytes(1n << 40n, 5), /does not fit/);
	assert.throws(() => uintBytes(-1n, 5), /negative/);
});

test("fullRange emits salt, deadline, then the curve", () => {
	const program = fullRange({ salt: 0xdeadbeefn, deadline: 1800000000 });
	const decoded = decodeProgram(program);

	assert.deepEqual(
		decoded.map((i) => i.opcode),
		[OP.SALT, OP.DEADLINE, OP.XYC_SWAP_XD],
	);
	// The curve is terminal — anything adjusting balances or fees must precede it
	// or the VM reverts, so its position is a correctness property, not style.
	assert.equal(decoded.at(-1)?.opcode, OP.XYC_SWAP_XD);
});

test("fullRange round-trips and is a pure function of its parameters", () => {
	const params = { salt: 1n, deadline: 1800000000 };
	assert.equal(toHex(fullRange(params)), toHex(fullRange(params)));
	// Golden file. Byte-for-byte:
	//   15 08 0000000000000001   SALT, 8 bytes
	//   0d 05 006b49d200         DEADLINE, 5 bytes (1800000000)
	//   11 00                    XYC_SWAP_XD, no args
	assert.equal(
		toHex(fullRange(params)),
		"0x150800000000000000010d05006b49d2001100",
	);
});

test("fullRangeWithFee inserts the fee before the curve — golden", () => {
	// Byte-for-byte:
	//   15 08 0000000000000001   SALT
	//   0d 05 006b49d200         DEADLINE (1800000000)
	//   16 04 0007a120           FLAT_FEE_AMOUNT_IN_XD (500000 = 0.05% of 1e9)
	//   11 00                    XYC_SWAP_XD
	// The fee MUST precede the curve: _flatFeeAmountInXD reverts if amounts were
	// already computed, so this ordering is a chain-enforced property.
	assert.equal(
		toHex(fullRangeWithFee({ salt: 1n, deadline: 1800000000, feeBps: 500_000 })),
		"0x150800000000000000010d05006b49d20016040007a1201100",
	);
});

test("fullRangeWithFee refuses a fee at or past 100%", () => {
	// BPS is 1e9, and _flatFeeAmountInXD divides by (BPS - feeBps).
	assert.throws(() => fullRangeWithFee({ salt: 1n, deadline: 1, feeBps: 1_000_000_000 }), /feeBps/);
});

test("a different salt produces different bytes", () => {
	// This is the whole point of the salt: a docked strategy is burned
	// permanently, so re-entering a position needs new bytes. F1 §2.
	const a = fullRange({ salt: 1n, deadline: 1800000000 });
	const b = fullRange({ salt: 2n, deadline: 1800000000 });
	assert.notEqual(toHex(a), toHex(b));
	assert.equal(a.length, b.length);
});

test("every emitted opcode is dispatchable", () => {
	for (const ins of decodeProgram(fullRange({ salt: 7n, deadline: 1800000000 }))) {
		assert.ok(
			isRealOpcode(ins.opcode),
			`0x${ins.opcode.toString(16)} is outside ${FIRST_REAL_OPCODE}-${LAST_REAL_OPCODE}`,
		);
	}
});

test("decodeProgram rejects truncated programs", () => {
	// A wrong argsLength shifts every later instruction, so this must not be
	// tolerated silently.
	assert.throws(() => decodeProgram(new Uint8Array([OP.DEADLINE, 0x05, 0x01])), /truncated/);
	assert.throws(() => decodeProgram(new Uint8Array([OP.SALT])), /truncated/);
});

test("formatProgram renders instructions by name", () => {
	assert.equal(
		formatProgram(fullRange({ salt: 0xffn, deadline: 1800000000 })),
		[
			"SALT 0x00000000000000ff",
			"DEADLINE 0x006b49d200",
			"XYC_SWAP_XD",
		].join("\n"),
	);
});

test("encodeProgram concatenates in order", () => {
	const program = encodeProgram([salt(0n), deadline(1)]);
	assert.equal(toHex(program), "0x150800000000000000000d050000000001");
});
