// Strategy fixtures: the bridge that keeps ONE encoder.
//
// The contracts do not assemble strategies. This module builds them with the
// same code the composer uses, and writes the resulting bytes to
// config/fixtures/strategies.json for the Foundry tests and scripts to ship
// verbatim.
//
// That inversion matters for more than tidiness. When Solidity had its own
// encoder, the fork test proved that SOLIDITY's bytes fill — but production
// ships the composer's bytes, so the thing we actually ship was never exercised
// on chain. Reading the fixture makes the test prove the real claim: these exact
// bytes, the ones the composer emits, ship and fill.
//
// Regenerate with:  npm run fixtures
// Staleness is caught by fixtures.test.ts, which rebuilds from the recorded
// inputs and asserts byte equality.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { fullRange, aquaOrder, shipBytes, strategyHash, toHex } from "./swapvm.ts";
import { SWAPVM_ROUTER_VERSION } from "./opcodes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(HERE, "../../../config");
export const FIXTURES_PATH = resolve(CONFIG_DIR, "fixtures/strategies.json");
const ADDRESSES_PATH = resolve(CONFIG_DIR, "addresses.8453.json");

/// The inputs are recorded alongside the outputs so the fixture can be rebuilt
/// and compared without anyone having to remember what produced it.
export type StrategyFixture = {
	name: string;
	description: string;
	template: string;
	inputs: { maker: string; salt: string; deadline: number; tokens: string[]; amounts: string[] };
	outputs: { traits: string; program: string; strategy: string; strategyHash: string };
};

/// Deterministic, so regenerating produces no diff. Real recommendations vary
/// the salt per recommendation — a docked hash is burned permanently and amounts
/// are not in the preimage, so a fixed salt would collide on re-ship. F1 §2.
function fixtureSalt(name: string): bigint {
	let h = 0n;
	for (const ch of name) h = (h * 131n + BigInt(ch.charCodeAt(0))) % (1n << 64n);
	return h;
}

export function buildFixtures(): { routerVersion: string; strategies: StrategyFixture[] } {
	const addresses = JSON.parse(readFileSync(ADDRESSES_PATH, "utf8"));
	const usdc: string = addresses.tokens.USDC;
	const usde: string = addresses.tokens.USDe;

	// A fixed maker and deadline keep the fixture reproducible. The Foundry test
	// pranks this address; the scripts override both from the environment.
	const maker = "0x00000000000000000000000000000000000f1152";
	const deadline = 1800000000; // 2027-01-15, comfortably past any rehearsal

	const strategies: StrategyFixture[] = [];

	{
		const name = "usdc-usde-full-range";
		const salt = fixtureSalt(name);
		const program = fullRange({ salt, deadline });
		const order = aquaOrder(maker, program);

		strategies.push({
			name,
			description:
				"Market-make USDC/USDe across the whole price range. Both are dollar-denominated, " +
				"so equal nominal value on each side prices near 1:1. The 6dp/18dp difference is " +
				"carried entirely by the amounts — 10_000e6 against 10_000e18 IS the 1:1 price, " +
				"and there is no decimals field anywhere in the program.",
			template: "full-range",
			inputs: {
				maker,
				salt: salt.toString(),
				deadline,
				tokens: [usdc, usde],
				amounts: ["10000000000", "10000000000000000000000"],
			},
			outputs: {
				traits: `0x${order.traits.toString(16)}`,
				program: toHex(program),
				strategy: toHex(shipBytes(order)),
				strategyHash: strategyHash(order),
			},
		});
	}

	return { routerVersion: SWAPVM_ROUTER_VERSION, strategies };
}

/// Returns only the payload. The `_generated` / `_why` keys are documentation for
/// anyone who opens the file, so they are dropped here — otherwise the staleness
/// check would compare prose against a freshly built object and always fail.
export function readFixtures(): { routerVersion: string; strategies: StrategyFixture[] } {
	const { routerVersion, strategies } = JSON.parse(readFileSync(FIXTURES_PATH, "utf8"));
	return { routerVersion, strategies };
}

export function writeFixtures(): string {
	const built = buildFixtures();
	const body = {
		_generated: "DO NOT EDIT. Written by `npm run fixtures` from packages/arbitration-sdk/src/fixtures.ts.",
		_why:
			"The contracts have no strategy encoder. These bytes come from the same code the " +
			"composer uses, so the fork test proves the bytes we actually ship will fill.",
		...built,
	};
	mkdirSync(dirname(FIXTURES_PATH), { recursive: true });
	writeFileSync(FIXTURES_PATH, `${JSON.stringify(body, null, 2)}\n`);
	return FIXTURES_PATH;
}
