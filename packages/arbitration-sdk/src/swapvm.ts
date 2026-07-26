// SwapVM program and order assembly. THE encoder — there is no second one.
//
// Program encoding, from the deployed `ContextLib.runLoop`:
//
//     [opcode: 1 byte][argsLength: 1 byte][args: argsLength bytes]
//
// read in a loop until exhausted, dispatched by indexing `ctx.vm.opcodes[opcode]`.
// argsLength is a single byte, so no instruction may carry more than 255 bytes.
//
// Opcode NUMBERS are not here — they are data, in config/opcodes.8453.json.
// `npm run fixtures` writes the bytes this module produces to
// config/fixtures/strategies.json, which the Foundry tests and scripts ship
// verbatim, so what gets tested on chain is what the composer emits.

import { AbiCoder, keccak256 } from "ethers";
import { op, isRealOpcode, opcodeName, FEE_BPS_ONE } from "./opcodes.ts";

export type Instruction = { opcode: number; args: Uint8Array };

const MAX_ARGS_LENGTH = 255;

export function encodeInstruction(ins: Instruction): Uint8Array {
	if (!isRealOpcode(ins.opcode)) {
		// The no-op region silently does nothing on chain; past the end of the
		// dispatch array reverts an unnamed Panic(0x32). Neither may leave here.
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
// Widths are fixed by each instruction's natspec: the VM slices by offset, so a
// wrong width silently misreads every later field.

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

// `_salt` is a genuine no-op (empty body); it varies the bytes so two otherwise
// identical strategies hash differently. Amounts are NOT part of the strategy,
// and a docked hash is burned permanently, so the salt must vary per
// recommendation or a re-ship collides with a dead hash.
export function salt(value: bigint): Instruction {
	return { opcode: op("SALT"), args: uintBytes(value, 8) };
}

// `_deadline` reverts DeadlineReached once passed. args.deadline | 5 bytes.
export function deadline(unixSeconds: number): Instruction {
	return { opcode: op("DEADLINE"), args: uintBytes(BigInt(unixSeconds), 5) };
}

// `_xycSwapXD` takes NO arguments. Constant product over the shipped virtual
// balances, for whichever pair the taker names. Reverts
// XYCSwapRecomputeDetected if amounts were already computed, so "exactly one
// curve" is enforced by the VM, not by convention.
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

// `_xycConcentrateGrowLiquidity2D` — grows both effective balances by a delta
// before the curve runs, concentrating shipped liquidity around the shipped
// price. args are deltaLt || deltaGt (32 bytes each), keyed by TOKEN SORT ORDER:
// the deployed build2D/parse2D map them back by comparing tokenIn < tokenOut at
// swap time, so the encoder sorts here and callers pass deltas aligned with the
// token order they were computed for.
//
// A wrapper like the fee (calls ctx.runLoop() and post-processes), so it MUST
// precede the curve and requires the curve to have computed both amounts — a
// program ending in this instruction reverts. It also persists a per-orderHash
// scale on the router (deltaScales), which fresh salted bytes start clean —
// another reason every strategy carries a salt.
export function xycConcentrateGrowLiquidity2D(
	tokenA: string,
	tokenB: string,
	deltaA: bigint,
	deltaB: bigint,
): Instruction {
	const a = BigInt(tokenA);
	const b = BigInt(tokenB);
	if (a === b) throw new Error(`concentrate needs two distinct tokens, got ${tokenA} twice`);
	const [deltaLt, deltaGt] = a < b ? [deltaA, deltaB] : [deltaB, deltaA];
	const args = new Uint8Array(64);
	args.set(uintBytes(deltaLt, 32), 0);
	args.set(uintBytes(deltaGt, 32), 32);
	return { opcode: op("XYC_CONCENTRATE_GROW_LIQUIDITY_2D"), args };
}

// --- band arithmetic ---------------------------------------------------------

const ONE = 10n ** 18n; // the deployed XYCConcentrate's fixed point
const SQRT_ONE = 10n ** 9n;

// Floor integer square root, matching OZ Math.sqrt semantics.
function isqrt(n: bigint): bigint {
	if (n < 0n) throw new Error(`isqrt of negative: ${n}`);
	if (n < 2n) return n;
	let x0 = n;
	let x1 = (n + 1n) / 2n;
	while (x1 < x0) {
		x0 = x1;
		x1 = (x1 + n / x1) / 2n;
	}
	return x0;
}

// The deltas that concentrate `amounts` into a GEOMETRIC band around the
// shipped price: priceMax/price = price/priceMin = 1 + bandBps/1e9.
//
// The deployed XYCConcentrateArgsBuilder.computeDeltas specialised to that band:
// with both sqrt ratios equal, deltaA and deltaB are the same multiple of their
// amounts, so the grown pool still quotes EXACTLY the shipped ratio. An
// arithmetic band (price ± x%) makes the multipliers differ and shifts the
// quoted price off the shipped ratio by ~x% — hence a geometric helper rather
// than raw priceMin/priceMax.
//
// Inventory drains exactly when the price reaches a band edge; a draw past the
// edge exceeds the shipped virtual amount and reverts in Aqua's pull. Virtual
// amounts are a ceiling, not a promise.
export function bandDeltas(
	amountA: bigint,
	amountB: bigint,
	bandBps: number,
): { deltaA: bigint; deltaB: bigint } {
	if (!Number.isInteger(bandBps) || bandBps <= 0 || bandBps >= FEE_BPS_ONE) {
		throw new Error(`bandBps must be an integer in (0, ${FEE_BPS_ONE}): got ${bandBps}`);
	}
	if (amountA <= 0n || amountB <= 0n) {
		throw new Error(`band deltas need both amounts positive: got ${amountA}, ${amountB}`);
	}
	const bps = BigInt(FEE_BPS_ONE);
	// sqrt(1 + band) in 1e18 fixed point, floor — same op order as the deployed
	// computeDeltas: Math.sqrt(ratio1e18) * SQRT_ONE.
	const sqrtGrow = isqrt((ONE * (bps + BigInt(bandBps))) / bps) * SQRT_ONE;
	const denom = sqrtGrow - ONE;
	if (denom <= 0n) {
		// Flooring ate the whole band. Only reachable for bandBps < 3 (< 3e-7 %).
		throw new Error(`bandBps ${bandBps} is too narrow to represent in the VM's fixed point`);
	}
	return { deltaA: (amountA * ONE) / denom, deltaB: (amountB * ONE) / denom };
}

// --- templates ---------------------------------------------------------------

export type FullRangeParams = { salt: bigint; deadline: number };

// Market-make across the whole price range at the ratio implied by the shipped
// amounts.
//
// The curve goes LAST. It is terminal, and both the fee and decay instructions
// revert if amounts have already been computed, so ordering is enforced by the
// VM, not by convention. PRICE is the ratio of the shipped virtual amounts and
// DEPTH is their absolute size; neither is in the program — the economic content
// lives in ship()'s arguments.
export function fullRange(p: FullRangeParams): Uint8Array {
	return encodeProgram([salt(p.salt), deadline(p.deadline), xycSwap()]);
}

export function fullRangeWithFee(p: FullRangeParams & { feeBps: number }): Uint8Array {
	return encodeProgram([salt(p.salt), deadline(p.deadline), flatFeeAmountIn(p.feeBps), xycSwap()]);
}

export type BandedParams = FullRangeParams & {
	bandBps: number; // geometric half-width, out of FEE_BPS_ONE (1e9) like feeBps
	tokens: [string, string];
	amounts: [bigint, bigint]; // raw units, aligned with tokens
};

// Concentrate the shipped liquidity into a band around the shipped price: same
// price and same real commitment as full-range, but multiplied quote depth, and
// inventory drains exactly at the band edges.
//
// Unlike full-range, the PROGRAM depends on the ship amounts: the concentrate
// deltas are computed from them, so the amounts passed to ship() must be the
// amounts compiled here or the band sits around the wrong price. The band goes
// before the fee, both before the curve — each wraps what follows, and the VM
// reverts any other order.
export function banded(p: BandedParams): Uint8Array {
	const { deltaA, deltaB } = bandDeltas(p.amounts[0], p.amounts[1], p.bandBps);
	return encodeProgram([
		salt(p.salt),
		deadline(p.deadline),
		xycConcentrateGrowLiquidity2D(p.tokens[0], p.tokens[1], deltaA, deltaB),
		xycSwap(),
	]);
}

export function bandedWithFee(p: BandedParams & { feeBps: number }): Uint8Array {
	const { deltaA, deltaB } = bandDeltas(p.amounts[0], p.amounts[1], p.bandBps);
	return encodeProgram([
		salt(p.salt),
		deadline(p.deadline),
		xycConcentrateGrowLiquidity2D(p.tokens[0], p.tokens[1], deltaA, deltaB),
		flatFeeAmountIn(p.feeBps),
		xycSwap(),
	]);
}

// --- the Aqua order ----------------------------------------------------------

// MakerTraits bit 254. In Aqua mode balances come from Aqua rather than from a
// maker signature, letting one wallet back the strategy.
export const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;

export type Order = { maker: string; traits: bigint; program: Uint8Array };

// With no maker hooks all four hook slice indexes are zero, so the program starts
// at offset 0 of `data` and `data` IS the program. The receiver occupies the low
// 160 bits of traits and must equal the maker — the router rejects a custom
// receiver in Aqua mode.
//
// tokenIn/tokenOut are NOT in the order and NOT in its hash; the taker passes
// them to swap(). One shipped strategy therefore serves every pair among its
// tokens.
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

// Computable before the user signs anything, so the UI can show it and the
// recommendation can commit to it on-chain.
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

// Reverse of shipBytes(): recover the Order from the exact bytes ship() stored
// (the subgraph's `strategyData`), so the dashboard reads a position's program
// and deadline from the chain rather than from client-side memory.
export function decodeOrder(data: Uint8Array): Order {
	const [decoded] = AbiCoder.defaultAbiCoder().decode(
		["tuple(address maker, uint256 traits, bytes data)"],
		toHex(data),
	);
	return {
		maker: decoded.maker,
		traits: BigInt(decoded.traits),
		program: fromHex(decoded.data),
	};
}

// The DEADLINE instruction's unix seconds, or null when the program carries
// none. Our templates always emit one, but a maker's book can hold strategies
// shipped outside Sluice, which must render as "no deadline", not as 1970.
export function deadlineOf(instructions: Instruction[]): number | null {
	const found = instructions.find((ins) => ins.opcode === op("DEADLINE"));
	if (!found) return null;
	let value = 0n;
	for (const b of found.args) value = (value << 8n) | BigInt(b);
	return Number(value);
}

// Used by the app's "why this" expander to show structured instructions rather
// than a wall of bytes.
export function formatProgram(program: Uint8Array): string {
	return decodeProgram(program)
		.map((ins) => `${opcodeName(ins.opcode)}${ins.args.length ? ` ${toHex(ins.args)}` : ""}`)
		.join("\n");
}
