import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVerified, formatOutput, type InferResult } from "./proof.ts";

test("computeVerified requires both a signer and processResponse", () => {
	assert.equal(computeVerified("0xabc", true), true);
	assert.equal(computeVerified(null, true), false);
	assert.equal(computeVerified("0xabc", false), false);
});

test("formatOutput shows result then a proof block with the signer and proof URL", () => {
	const r: InferResult = {
		resultText: "hello world",
		signedText: "hello world",
		signature: "0x9f2c0000",
		signer: "0xAbc0000000000000000000000000000000000123",
		chatID: "7f3a0000",
		latencyMs: 3140,
		processResponseOk: true,
		verified: true,
		proofUrl: "https://prov/v1/proxy/signature/7f3a0000?model=m",
	};
	const out = formatOutput(r);
	assert.match(out, /result: hello world/);
	assert.match(out, /signer\s+0xAbc0000000000000000000000000000000000123/);
	assert.match(out, /verified\s+✓/);
	assert.match(
		out,
		/proof URL\s+https:\/\/prov\/v1\/proxy\/signature\/7f3a0000\?model=m/,
	);
	assert.match(out, /latency 3140ms/);
});

test("formatOutput marks an unverified result with ✗", () => {
	const r: InferResult = {
		resultText: "x",
		signedText: "x",
		signature: "0x",
		signer: null,
		chatID: "c",
		latencyMs: 10,
		processResponseOk: false,
		verified: false,
		proofUrl: "https://prov/v1/proxy/signature/c?model=m",
	};
	assert.match(formatOutput(r), /verified\s+✗/);
});
