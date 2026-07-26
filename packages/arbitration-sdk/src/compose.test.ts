// Tests for the validator-driven reject-and-re-infer loop (Issue 6).
//
// compose() is exercised through an injected fake inference function, so no 0G
// broker, network, or signature round-trip is touched. The fake both scripts
// the model's replies and records the messages it was sent, which lets us assert
// that a rejection's feedback is actually handed back on the next attempt.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	compose,
	buildComposeMessages,
	chainStateFor,
	BASE_CHAIN_ID,
	MAX_COMPOSE_ATTEMPTS,
	type InferFn,
} from "./compose.ts";
import { stubContext, TOKENS } from "./context.ts";
import { bandTiers } from "./tiers.ts";
import { FALLBACK_SOURCE } from "./fallback.ts";
import type { Config } from "./config.ts";
import type { ZGBroker } from "./inference.ts";
import type { InferResult } from "./proof.ts";
import type { RecommendationRequest } from "./recommendation.ts";

const CTX = stubContext(); // observedAt 1_750_000_000, observedBlock 22_500_000
const NOW = CTX.observedAt;

const REQ: RecommendationRequest = {
	prompt: "make a market on my USDC",
	budget: [{ symbol: "USDC", address: TOKENS.USDC.address, amount: "100" }],
	maxStrategies: 3,
	maxDeadlineSec: 604_800,
};

// A well-formed recommendation drawing `amount` USDC. Echoes the context's
// block/time so the freshness (I12) and deadline (I7) checks pass — those are
// the model's to get right, not what these tests are probing.
function rec(amount: string) {
	return {
		schema: "sluice.recommendation/1",
		chainId: BASE_CHAIN_ID,
		observedAt: CTX.observedAt,
		observedBlock: CTX.observedBlock,
		strategies: [
			{
				templateId: "full-range",
				slots: {
					curve: { instruction: "XYC_SWAP_XD" },
					deadline: { deadline: NOW + 3600 },
				},
				tokens: [TOKENS.USDC.address],
				virtualAmounts: [amount],
			},
		],
	};
}

function result(text: string): InferResult {
	return {
		resultText: text,
		signedText: "",
		signature: "",
		signer: null,
		chatID: "chat-test",
		latencyMs: 1,
		processResponseOk: false,
		verified: false,
		proofUrl: "",
	};
}

// Scripts the fake's replies (last one repeats once exhausted) and records every
// message array it was handed.
function fakeInfer(...texts: string[]): { fn: InferFn; calls: string[][] } {
	const calls: string[][] = [];
	let i = 0;
	const fn: InferFn = async (_broker, _cfg, messages) => {
		calls.push(messages.map((m) => m.content));
		const text = texts[Math.min(i, texts.length - 1)];
		i += 1;
		return result(text);
	};
	return { fn, calls };
}

const BROKER = {} as unknown as ZGBroker;
const CFG = {} as unknown as Config;

test("the prompt states the concrete chain id, block, and deadline window", () => {
	// Without these the 7B model invents chainId 1 and a training-era deadline —
	// rejected by I4/I7 on every attempt. The prompt must hand it the values to
	// echo. (See the 0G probe: this is what turns the validator loop from
	// always-fallback into a first-attempt ENCLAVE result.)
	const [, userMsg] = buildComposeMessages(REQ, CTX);
	const now = CTX.observedAt;
	const deadlineMax = now + REQ.maxDeadlineSec;

	assert.match(userMsg.content, new RegExp(`chainId: ${BASE_CHAIN_ID}\\b`));
	assert.match(userMsg.content, new RegExp(`observedAt: ${now}\\b`));
	assert.match(
		userMsg.content,
		new RegExp(`observedBlock: ${CTX.observedBlock}\\b`),
	);
	// The exact validator window (now, now + maxDeadlineSec].
	assert.match(userMsg.content, new RegExp(`\\(${now}, ${deadlineMax}\\]`));
});

test("chainStateFor derives the chain facts from the context", () => {
	const s = chainStateFor(CTX);
	assert.equal(s.chainId, BASE_CHAIN_ID);
	assert.equal(s.headBlock, CTX.observedBlock);
	assert.equal(s.now, CTX.observedAt);
});

test("a valid first attempt returns ENCLAVE without re-inferring", async () => {
	const { fn, calls } = fakeInfer(JSON.stringify(rec("100")));
	const r = await compose(BROKER, CFG, REQ, CTX, { infer: fn });

	assert.equal(r.source, "ENCLAVE");
	assert.equal(r.attempts, 1);
	assert.deepEqual(r.violations, []);
	assert.equal(calls.length, 1);
});

test("malformed output is re-inferred with the structural errors fed back", async () => {
	const { fn, calls } = fakeInfer(
		"not json at all",
		JSON.stringify(rec("100")),
	);
	const r = await compose(BROKER, CFG, REQ, CTX, { infer: fn });

	assert.equal(r.source, "ENCLAVE");
	assert.equal(r.attempts, 2);
	assert.equal(calls.length, 2);
	// The second attempt was told the previous one was rejected.
	assert.match(calls[1].join("\n"), /PREVIOUS ATTEMPT WAS REJECTED/);
});

test("a validator violation drives a re-infer with the invariant fed back", async () => {
	// First reply is well-formed but draws 200 USDC on a 100 budget → I2.
	const { fn, calls } = fakeInfer(
		JSON.stringify(rec("200")),
		JSON.stringify(rec("100")),
	);
	const r = await compose(BROKER, CFG, REQ, CTX, { infer: fn });

	assert.equal(r.source, "ENCLAVE");
	assert.equal(r.attempts, 2);
	assert.deepEqual(r.violations, []);
	// The re-infer carried the failing invariant back to the model.
	assert.match(calls[1].join("\n"), /I2/);
});

test("a persistently violating model falls back to a labelled template", async () => {
	// Every reply is over budget: the validator never clears it.
	const { fn, calls } = fakeInfer(JSON.stringify(rec("200")));
	const r = await compose(BROKER, CFG, REQ, CTX, { infer: fn });

	assert.equal(r.source, FALLBACK_SOURCE);
	assert.equal(r.attempts, MAX_COMPOSE_ATTEMPTS);
	assert.equal(calls.length, MAX_COMPOSE_ATTEMPTS);
	// The result records WHY it fell back — the last model attempt's violations.
	assert.ok(r.violations.some((v) => v.code === "I2"));
	// The returned recommendation is the deterministic, within-budget fallback.
	assert.ok(r.parse.ok && r.parse.recommendation);
	assert.equal(r.parse.recommendation!.strategies[0].virtualAmounts[0], "100");
});

test("the composer never mutates the request or context", async () => {
	const reqCopy = structuredClone(REQ);
	const ctxCopy = structuredClone(CTX);
	const { fn } = fakeInfer(JSON.stringify(rec("100")));
	await compose(BROKER, CFG, REQ, CTX, { infer: fn });

	assert.deepEqual(REQ, reqCopy);
	assert.deepEqual(CTX, ctxCopy);
});

// ---- The Tier 0 "echo, don't compute" blocks (#24, #25, #26) --------------
//
// Each block exists because the alternative is a 7B model deriving the value
// itself: classifying the user's risk wording, dividing a budget by a mid
// price across two decimal scales, or picking band widths from a volatility.
// These assert the derived values actually reach the prompt.

const PAIR_REQ: RecommendationRequest = {
	prompt: "market-make WETH/USDC, keep it safe",
	budget: [
		{ symbol: "WETH", address: TOKENS.WETH.address, amount: "2" },
		{ symbol: "USDC", address: TOKENS.USDC.address, amount: "3000" },
	],
	maxStrategies: 3,
	maxDeadlineSec: 604_800,
};

test("the prompt states the risk appetite read from the user's words", () => {
	const [, user] = buildComposeMessages(PAIR_REQ, CTX);
	assert.match(user.content, /RISK APPETITE .*: CONSERVATIVE/);

	const [, degen] = buildComposeMessages(
		{ ...PAIR_REQ, prompt: "max yield, I can stomach it" },
		CTX,
	);
	assert.match(degen.content, /RISK APPETITE .*: AGGRESSIVE/);
});

test("the prompt carries pairing arithmetic the model would otherwise do itself", () => {
	const [, user] = buildComposeMessages(PAIR_REQ, CTX);
	// 3000 USDC binds against 2 WETH at mid 3450 → 0.869565 WETH, 1000 each.
	assert.match(user.content, /REFERENCE PAIRING/);
	assert.ok(user.content.includes("0.869565"), "value-matched total missing");
	assert.ok(user.content.includes("0.289855"), "per-strategy share missing");
});

test("the prompt carries band tiers, with the appetite applied", () => {
	const [, user] = buildComposeMessages(PAIR_REQ, CTX);
	assert.match(user.content, /SUGGESTED BAND TIERS/);
	for (const t of bandTiers(
		CTX.pair.realizedVol7dPct,
		PAIR_REQ.maxDeadlineSec,
		"conservative",
	)) {
		assert.ok(user.content.includes(String(t.bandBps)), `${t.bandBps} missing`);
	}
});

test("blocks are omitted, never faked, when their inputs are absent", () => {
	// A single-token budget has no second side to pair against: no pairing block
	// rather than an invented counterpart. (REQ is USDC-only.)
	const [, single] = buildComposeMessages(REQ, CTX);
	assert.ok(!single.content.includes("REFERENCE PAIRING"));

	// A request that cannot carry three strategies gets no tier block rather
	// than a truncated one.
	const [, oneShot] = buildComposeMessages({ ...PAIR_REQ, maxStrategies: 1 }, CTX);
	assert.ok(!oneShot.content.includes("SUGGESTED BAND TIERS"));
	// ...but the pairing block stays, now split for a single strategy.
	assert.ok(oneShot.content.includes("REFERENCE PAIRING"));
});

test("the tier block never outlives its stub label", () => {
	// Pair data is a stub end to end (F3 job 2). The tiers are derived from it,
	// so they must inherit the label — the same rule contextPromptBlock follows.
	const [, user] = buildComposeMessages(PAIR_REQ, CTX);
	const tierBlock = user.content.slice(user.content.indexOf("SUGGESTED BAND TIERS"));
	assert.match(tierBlock, /STUB/);
});

test("rejection feedback still lands after the new blocks", () => {
	const [, user] = buildComposeMessages(PAIR_REQ, CTX, "I7: deadline is stale");
	assert.match(user.content, /PREVIOUS ATTEMPT WAS REJECTED/);
	assert.ok(
		user.content.indexOf("PREVIOUS ATTEMPT") >
			user.content.indexOf("SUGGESTED BAND TIERS"),
		"feedback must come last, closest to the model's turn",
	);
});
