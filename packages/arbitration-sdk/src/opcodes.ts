// The SwapVM opcode table, loaded from config/opcodes.8453.json.
//
// The numbers live in that file and NOWHERE else. They are deployment-specific
// data — pinned empirically against the Sourcify-verified deployed source and
// confirmed by executing each opcode on a fork — not something derivable from
// any source you can read safely. Read the `_neverDeriveFromMaster` and
// `_neverReadTheLiteralTopToBottom` notes in the JSON before touching them.
//
// This module's only jobs are to load that data, fail loudly if it is malformed,
// and hand out named constants so a redeployment is a change to one JSON file
// rather than a hunt through the templates.
//
// Loaded through a static JSON import rather than `node:fs` — `grammar.ts`
// (which needs OP/FEE_BPS_ONE) is a real, non-type import of this module from
// `from-server.ts`, and that mapper runs client-side in the compose screen, so
// this module has to bundle for the browser too, not just for the CLIs.

import table from "../../../config/opcodes.8453.json";

// packages/arbitration-sdk/src -> repo root. The address book lives beside this
// file and the subgraph reads both, so config/ is the shared home rather than
// anything package-local. A label for error messages only now — the table
// itself comes in through the JSON import above, not a runtime file read.
export const OPCODES_PATH = "config/opcodes.8453.json";

type OpcodeTable = {
	chainId: number;
	router: string;
	routerVersion: string;
	firstRealOpcode: number;
	lastRealOpcode: number;
	opcodes: Record<string, number>;
	argWidths: Record<string, number>;
	feeBpsOne: number;
};

function load(): OpcodeTable {
	const raw = table as OpcodeTable;

	// Validate on import rather than at the first bad emit. A malformed table is
	// the one failure that can produce a program which runs and does nothing.
	for (const field of ["firstRealOpcode", "lastRealOpcode", "feeBpsOne"] as const) {
		if (typeof raw[field] !== "number") {
			throw new Error(`${OPCODES_PATH}: ${field} missing or not a number`);
		}
	}
	if (!raw.opcodes || Object.keys(raw.opcodes).length === 0) {
		throw new Error(`${OPCODES_PATH}: no opcodes`);
	}
	for (const [name, value] of Object.entries(raw.opcodes)) {
		if (!Number.isInteger(value) || value < raw.firstRealOpcode || value > raw.lastRealOpcode) {
			throw new Error(
				`${OPCODES_PATH}: ${name} = ${value} is outside the dispatchable range ` +
					`${raw.firstRealOpcode}-${raw.lastRealOpcode}`,
			);
		}
	}
	const seen = new Map<number, string>();
	for (const [name, value] of Object.entries(raw.opcodes)) {
		const clash = seen.get(value);
		if (clash) throw new Error(`${OPCODES_PATH}: ${name} and ${clash} both map to ${value}`);
		seen.set(value, name);
	}
	return raw;
}

const TABLE = load();

/// The deployed router these numbers were pinned against. Assert this matches
/// `swapVMRouterVersion` in the address book before signing anything — the table
/// is a property of the deployment, not of the chain.
export const SWAPVM_ROUTER_VERSION = TABLE.routerVersion;
export const SWAPVM_ROUTER = TABLE.router;

export const OP: Readonly<Record<string, number>> = Object.freeze({ ...TABLE.opcodes });
export const ARG_WIDTHS: Readonly<Record<string, number>> = Object.freeze({ ...TABLE.argWidths });

/// 1e9 = 100%. Not 1e4 — 0.3% is 3_000_000.
export const FEE_BPS_ONE = TABLE.feeBpsOne;

/// Below this are `_notInstruction` no-ops that do NOT revert.
export const FIRST_REAL_OPCODE = TABLE.firstRealOpcode;
/// Above this the dispatch array is indexed out of bounds — Panic(0x32).
export const LAST_REAL_OPCODE = TABLE.lastRealOpcode;

export function isRealOpcode(opcode: number): boolean {
	return Number.isInteger(opcode) && opcode >= FIRST_REAL_OPCODE && opcode <= LAST_REAL_OPCODE;
}

/// Look up an opcode by name, refusing silently-wrong lookups.
export function op(name: string): number {
	const value = OP[name];
	if (value === undefined) throw new Error(`unknown opcode name: ${name}`);
	return value;
}

const NAMES: Readonly<Record<number, string>> = Object.freeze(
	Object.fromEntries(Object.entries(OP).map(([name, value]) => [value, name])),
);

export function opcodeName(opcode: number): string {
	if (NAMES[opcode]) return NAMES[opcode];
	if (opcode < FIRST_REAL_OPCODE) return `NO_OP(0x${opcode.toString(16).padStart(2, "0")})`;
	return `OUT_OF_RANGE(0x${opcode.toString(16).padStart(2, "0")})`;
}
