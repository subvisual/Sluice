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
	xycConcentrateGrowLiquidity2D,
	bandDeltas,
	fullRange,
	fullRangeWithFee,
	banded,
	bandedWithFee,
	type BandedParams,
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

// The fixture pair: USDe sorts BELOW USDC by address, so passing [USDC, USDe]
// exercises the sort in the encoder rather than agreeing with it by accident.
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDE = "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34";
const BANDED_PARAMS: BandedParams = {
	salt: 1n,
	deadline: 1800000000,
	bandBps: 10_000_000, // 1% of 1e9
	tokens: [USDC, USDE],
	amounts: [10_000_000_000n, 10_000_000_000_000_000_000_000n], // 10_000e6, 10_000e18
};

test("bandDeltas grows both sides by the same multiple — the price is preserved", () => {
	// A 1% GEOMETRIC band: priceMax/price = price/priceMin = 1.01. Independently:
	// sqrt(1.01e18) floors to 1004987562e9, denom = 4987562e9, multiplier
	// 1e18/denom ≈ 200.4988. An arithmetic ±1% band would give the two sides
	// different multipliers and shift the quoted price off the shipped ratio.
	const { deltaA, deltaB } = bandDeltas(10_000_000_000n, 10_000_000_000_000_000_000_000n, 10_000_000);
	assert.equal(deltaA, 2004987607171n);
	assert.equal(deltaB, 2004987607171600072339952n);
	// Same multiplier on both sides, to within the flooring of each division.
	assert.equal(deltaA, deltaB / 1_000_000_000_000n);
});

test("bandDeltas refuses out-of-range and degenerate bands", () => {
	const a = 10_000_000_000n;
	const b = 10_000_000_000_000_000_000_000n;
	assert.throws(() => bandDeltas(a, b, 0), /bandBps/);
	assert.throws(() => bandDeltas(a, b, 1_000_000_000), /bandBps/);
	assert.throws(() => bandDeltas(a, b, 1.5), /bandBps/);
	assert.throws(() => bandDeltas(0n, b, 10_000_000), /positive/);
	// bandBps 1 survives the range check but floors to nothing in the VM's
	// fixed point — it must throw, not emit zero deltas that no-op the band.
	assert.throws(() => bandDeltas(a, b, 1), /too narrow/);
});

test("concentrate2D args are keyed by token sort order, not argument order", () => {
	// The deployed parse2D maps deltaLt/deltaGt back by comparing addresses at
	// swap time, so the encoder must sort the same way. USDe < USDC, so USDe's
	// delta lands first whichever way the tokens are passed.
	const ins = xycConcentrateGrowLiquidity2D(USDC, USDE, 7n, 9n);
	const flipped = xycConcentrateGrowLiquidity2D(USDE, USDC, 9n, 7n);
	assert.equal(toHex(ins.args), toHex(flipped.args));
	assert.equal(ins.args.length, 64);
	assert.equal(toHex(ins.args.slice(0, 32)), toHex(uintBytes(9n, 32))); // USDe's delta
	assert.equal(toHex(ins.args.slice(32)), toHex(uintBytes(7n, 32))); // USDC's delta
	assert.throws(() => xycConcentrateGrowLiquidity2D(USDC, USDC, 1n, 2n), /distinct/);
});

test("banded emits salt, deadline, concentrate, then the curve — golden", () => {
	// Byte-for-byte:
	//   15 08 0000000000000001   SALT
	//   0d 05 006b49d200         DEADLINE (1800000000)
	//   13 40 <deltaLt(32)><deltaGt(32)>  XYC_CONCENTRATE_GROW_LIQUIDITY_2D
	//        deltaLt = USDe's 2004987607171600072339952, deltaGt = USDC's 2004987607171
	//   11 00                    XYC_SWAP_XD
	assert.equal(
		toHex(banded(BANDED_PARAMS)),
		"0x150800000000000000010d05006b49d20013400000000000000000000000000000000000" +
			"0000000001a8929891d2f38f1071f000000000000000000000000000000000000000000000" +
			"0000000001d2d292f8831100",
	);
});

test("bandedWithFee inserts the fee between the concentrate and the curve — golden", () => {
	// The band wraps the fee wraps the curve: both are runLoop wrappers, and the
	// VM reverts any of them placed after amounts are computed. This matches the
	// filled shape observed on real Base (concentrate before fee before curve).
	assert.equal(
		toHex(bandedWithFee({ ...BANDED_PARAMS, feeBps: 500_000 })),
		"0x150800000000000000010d05006b49d20013400000000000000000000000000000000000" +
			"0000000001a8929891d2f38f1071f000000000000000000000000000000000000000000000" +
			"0000000001d2d292f88316040007a1201100",
	);
});

test("the banded program depends on the ship amounts", () => {
	// Unlike full-range, the deltas are computed FROM the amounts — shipping
	// different amounts under the same program would put the band around the
	// wrong price, so distinct amounts must yield distinct bytes.
	const other = banded({ ...BANDED_PARAMS, amounts: [20_000_000_000n, 20_000_000_000_000_000_000_000n] });
	assert.notEqual(toHex(other), toHex(banded(BANDED_PARAMS)));
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
