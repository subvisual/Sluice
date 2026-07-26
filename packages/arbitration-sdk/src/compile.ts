// Recommendation -> shippable Aqua inputs. Bridges a validated
// StrategyRecommendation to the fork-proven swapvm builders: it owns the salt
// and the amount scaling, swapvm.ts owns the byte order. Every strategy it emits
// must be byte-identical to what the builders produce for the same salt/params
// (compile.test.ts).
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import type {
	StrategyRecommendation,
	SlotAssignment,
} from "./recommendation.ts";
import { TOKENS } from "./context.ts";
import {
	fullRange,
	fullRangeWithFee,
	banded,
	bandedWithFee,
	aquaOrder,
	shipBytes,
	strategyHash,
	toHex,
} from "./swapvm.ts";

export type ShipInput = {
	strategyHash: `0x${string}`;
	strategy: `0x${string}`; // abi.encode(order)
	tokens: `0x${string}`[];
	amounts: bigint[]; // raw base units, aligned with tokens
};

const U64 = (1n << 64n) - 1n;
const decimalsByAddress = new Map(
	Object.values(TOKENS).map((t) => [t.address.toLowerCase(), t.decimals]),
);

function decimalsOf(address: string): number {
	const d = decimalsByAddress.get(address.toLowerCase());
	if (d === undefined) throw new Error(`compile: unknown token ${address}`);
	return d;
}

// decimal string -> raw base units, exact (no float). The model's amounts are
// already truncated to the token's decimals upstream, so extra fraction digits
// here are a bug — reject them.
export function toBaseUnits(amount: string, decimals: number): bigint {
	const [whole, frac = ""] = amount.split(".");
	if (frac.length > decimals)
		throw new Error(`compile: ${amount} exceeds ${decimals} dp`);
	return BigInt(whole + frac.padEnd(decimals, "0"));
}

// uint64 salt from a per-recommendation seed and the strategy index. The VM's
// SALT arg is 8 bytes — take the LOW 64 bits, never the full 32-byte hash.
export function saltFor(seed: string, index: number): bigint {
	const h = keccak256(
		AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [seed, index]),
	);
	return BigInt(h) & U64;
}

// A stable seed for the whole recommendation: the enclave signature when we
// have it, else a hash of the canonical recommendation.
export function deriveSaltSeed(
	rec: StrategyRecommendation,
	signedText: string | null,
): string {
	return signedText
		? keccak256(toUtf8Bytes(signedText))
		: keccak256(toUtf8Bytes(JSON.stringify(rec)));
}

const req = <T>(v: T | undefined, name: string): T => {
	if (v === undefined) throw new Error(`compile: missing ${name}`);
	return v;
};
const pair = <T>(xs: T[]): [T, T] => {
	if (xs.length !== 2)
		throw new Error(`compile: banded needs exactly 2 tokens, got ${xs.length}`);
	return [xs[0], xs[1]];
};

function programFor(s: SlotAssignment, salt: bigint): Uint8Array {
	const deadline = s.slots.deadline.deadline;
	const tokens = s.tokens;
	const amounts = s.virtualAmounts.map((a, i) =>
		toBaseUnits(a, decimalsOf(tokens[i])),
	);
	const feeBps = s.slots.fee?.params?.feeBps as number | undefined;
	const bandBps = s.slots.band?.params?.bandBps as number | undefined;

	switch (s.templateId) {
		case "full-range":
			return fullRange({ salt, deadline });
		case "full-range-fee":
			return fullRangeWithFee({
				salt,
				deadline,
				feeBps: req(feeBps, "feeBps"),
			});
		case "banded":
			return banded({
				salt,
				deadline,
				bandBps: req(bandBps, "bandBps"),
				tokens: pair(tokens),
				amounts: pair(amounts),
			});
		case "banded-fee":
			return bandedWithFee({
				salt,
				deadline,
				bandBps: req(bandBps, "bandBps"),
				tokens: pair(tokens),
				amounts: pair(amounts),
				feeBps: req(feeBps, "feeBps"),
			});
		default:
			throw new Error(`compile: unknown templateId ${s.templateId}`);
	}
}

export function compileRecommendation(
	rec: StrategyRecommendation,
	maker: string,
	saltSeed: string,
): ShipInput[] {
	return rec.strategies.map((s, i) => {
		const program = programFor(s, saltFor(saltSeed, i));
		const order = aquaOrder(maker, program);
		return {
			strategyHash: strategyHash(order) as `0x${string}`,
			strategy: toHex(shipBytes(order)) as `0x${string}`,
			tokens: s.tokens.map((t) => t as `0x${string}`),
			amounts: s.virtualAmounts.map((a, k) =>
				toBaseUnits(a, decimalsOf(s.tokens[k])),
			),
		};
	});
}
