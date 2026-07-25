// SwapVM program and order assembly. THE encoder — there is no second one.
//
// ORDER LIVES HERE. The model never emits bytecode and never emits an
// instruction list; it picks a template and its parameters, and this module
// decides what bytes come out and in what sequence.
//
// Program encoding, from the deployed `ContextLib.runLoop`:
//
//     [opcode: 1 byte][argsLength: 1 byte][args: argsLength bytes]
//
// read in a loop until the program is exhausted, dispatched by indexing
// `ctx.vm.opcodes[opcode]`. argsLength is a single byte, so no instruction may
// carry more than 255 bytes of arguments.
//
// The opcode NUMBERS are not here — they are data, in config/opcodes.8453.json.
// Contracts do not re-implement any of this: `npm run fixtures` writes the bytes
// this module produces to config/fixtures/strategies.json, and the Foundry tests
// and scripts ship exactly those. That way what gets tested on chain is what the
// composer would actually emit.

import { AbiCoder, keccak256 } from "ethers";
import { op, isRealOpcode, opcodeName, FEE_BPS_ONE } from "./opcodes.ts";

export type Instruction = { opcode: number; args: Uint8Array };

const MAX_ARGS_LENGTH = 255;

export function encodeInstruction(ins: Instruction): Uint8Array {
	if (!isRealOpcode(ins.opcode)) {
		// Emitting into the no-op region would silently do nothing on chain; past
		// the end of the dispatch array it reverts an unnamed Panic(0x32). Neither
		// is allowed to leave this module.
		throw new Error(`refusing to emit ${opcodeName(ins.opcode)}: not a dispatchable opcode`);
	}
	if (ins.args.length > MAX_ARGS_LENGTH) {
		throw new Error(`args too long for ${opcodeName(ins.opcode)}: ${ins.args.length} > ${MAX_ARGS_LENGTH}`);
	}
	const out = new Uint8Array(2 + ins.args.length);
	out[0] = ins.opcode;
	out[1] = ins.args.length;
	out.set(ins.args, 2);
	return out;
}

export function encodeProgram(instructions: Instruction[]): Uint8Array {
	const parts = instructions.map(encodeInstruction);
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
}

// --- argument encoders -------------------------------------------------------
// Widths are fixed by each instruction's natspec and are not negotiable: the VM
// slices by offset, so a wrong width silently misreads every later field.

export function uintBytes(value: bigint, width: number): Uint8Array {
	if (value < 0n) throw new Error(`negative value: ${value}`);
	const max = (1n << BigInt(width * 8)) - 1n;
	if (value > max) throw new Error(`value ${value} does not fit in ${width} bytes`);
	const out = new Uint8Array(width);
	let v = value;
	for (let i = width - 1; i >= 0; i--) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

export function toHex(bytes: Uint8Array): string {
	return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function fromHex(hex: string): Uint8Array {
	const body = hex.startsWith("0x") ? hex.slice(2) : hex;
	const out = new Uint8Array(body.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
	return out;
}

// --- instructions ------------------------------------------------------------

// `_salt` is a genuine no-op — its body is empty. Its whole purpose is to vary
// the bytes so two otherwise-identical strategies hash differently. Amounts are
// NOT part of the strategy, and a docked hash is burned permanently, so the salt
// must vary per recommendation or a re-ship collides with a dead hash. F1 §2.
export function salt(value: bigint): Instruction {
	return { opcode: op("SALT"), args: uintBytes(value, 8) };
}

// `_deadline` reverts DeadlineReached once passed. args.deadline | 5 bytes.
export function deadline(unixSeconds: number): Instruction {
	return { opcode: op("DEADLINE"), args: uintBytes(BigInt(unixSeconds), 5) };
}

// `_xycSwapXD` takes NO arguments. Constant product over the virtual balances the
// strategy was shipped with, for whichever pair the taker names. Reverts
// XYCSwapRecomputeDetected if amounts were already computed — which is what makes
// "exactly one curve" enforced by the VM rather than by our convention.
export function xycSwap(): Instruction {
	return { opcode: op("XYC_SWAP_XD"), args: new Uint8Array(0) };
}

// `_flatFeeAmountInXD` — pure arithmetic, no token movement, so unlike the
// protocol-fee variants it cannot make quote() and swap() disagree.
export function flatFeeAmountIn(feeBps: number): Instruction {
	if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= FEE_BPS_ONE) {
		throw new Error(`feeBps must be an integer in [0, ${FEE_BPS_ONE}): got ${feeBps}`);
	}
	return { opcode: op("FLAT_FEE_AMOUNT_IN_XD"), args: uintBytes(BigInt(feeBps), 4) };
}

// --- templates ---------------------------------------------------------------

export type FullRangeParams = { salt: bigint; deadline: number };

// The simplest strategy that works: market-make across the whole price range at
// the ratio implied by the shipped amounts.
//
// The curve goes LAST. It is terminal, and both the fee and decay instructions
// revert if amounts have already been computed — so ordering is enforced by the
// VM, not merely by convention.
//
// Note how little is in these bytes: only the salt and the deadline vary. With
// this template the PRICE is the ratio of the shipped virtual amounts and the
// DEPTH is their absolute size, and neither is in the program. The economic
// content lives in ship()'s arguments.
export function fullRange(p: FullRangeParams): Uint8Array {
	return encodeProgram([salt(p.salt), deadline(p.deadline), xycSwap()]);
}

export function fullRangeWithFee(p: FullRangeParams & { feeBps: number }): Uint8Array {
	return encodeProgram([salt(p.salt), deadline(p.deadline), flatFeeAmountIn(p.feeBps), xycSwap()]);
}

// --- the Aqua order ----------------------------------------------------------

// MakerTraits bit 254. In Aqua mode balances come from Aqua rather than from a
// maker signature, which is what lets one wallet back the strategy.
export const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;

export type Order = { maker: string; traits: bigint; program: Uint8Array };

// With no maker hooks all four hook slice indexes are zero, so the program starts
// at offset 0 of `data` and `data` IS the program. The receiver occupies the low
// 160 bits of traits and must equal the maker — the router rejects a custom
// receiver in Aqua mode.
//
// tokenIn/tokenOut are NOT in the order and NOT in its hash; the taker passes
// them to swap(). One shipped strategy therefore serves every pair among the
// tokens it was shipped with.
export function aquaOrder(maker: string, program: Uint8Array): Order {
	return { maker, traits: USE_AQUA_INSTEAD_OF_SIGNATURE | BigInt(maker), program };
}

// The bytes handed to Aqua's ship(). Aqua stores keccak256 of these, and in Aqua
// mode the router computes keccak256(abi.encode(order)) — so these must be
// abi.encode(order) exactly, or the balances key to a hash no swap can reach.
export function shipBytes(order: Order): Uint8Array {
	const encoded = AbiCoder.defaultAbiCoder().encode(
		["tuple(address maker, uint256 traits, bytes data)"],
		[[order.maker, order.traits, toHex(order.program)]],
	);
	return fromHex(encoded);
}

// Computable before the user signs anything, which is what lets the UI show it
// and what the recommendation commits to on-chain.
export function strategyHash(order: Order): string {
	return keccak256(shipBytes(order));
}

// --- rendering ---------------------------------------------------------------

export function decodeProgram(program: Uint8Array): Instruction[] {
	const out: Instruction[] = [];
	let pc = 0;
	while (pc < program.length) {
		const opcode = program[pc++];
		if (pc >= program.length) throw new Error("truncated: missing argsLength");
		const argsLength = program[pc++];
		const end = pc + argsLength;
		if (end > program.length) throw new Error("truncated: args past program end");
		out.push({ opcode, args: program.slice(pc, end) });
		pc = end;
	}
	return out;
}

// Used by the app's "why this" expander, which shows the user structured
// instructions rather than a wall of bytes.
export function formatProgram(program: Uint8Array): string {
	return decodeProgram(program)
		.map((ins) => `${opcodeName(ins.opcode)}${ins.args.length ? ` ${toHex(ins.args)}` : ""}`)
		.join("\n");
}
