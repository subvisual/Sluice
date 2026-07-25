// Sealed composition: prompt + budget + context -> a grammar-shaped
// StrategyRecommendation, produced by a live 0G inference call.
//
// Scope: this is the "just get a recommendation" path. It reuses the Gate 0
// round-trip (inferChat) and receives the enclave signature, but does NOT
// verify it, commit it, or persist anything — verifiability is out of scope.
//
// The loop is validator-driven (F2 §4: "nothing is ever edited. Violations
// reject and re-infer"). Each attempt is parsed for shape and then run through
// the deterministic validator; a malformed OR violating output is fed back as
// rejection feedback and re-inferred, up to MAX_COMPOSE_ATTEMPTS. When the
// attempts are spent, the deterministic TEMPLATE_FALLBACK (Wiring §4 step 5b)
// takes over so a run always yields a well-formed recommendation — labelled,
// never presented as a model output.

import type { Config } from "./config.ts";
import { inferChat, type ChatMessage, type ZGBroker } from "./inference.ts";
import type { InferResult } from "./proof.ts";
import { grammarPromptBlock } from "./grammar.ts";
import { contextPromptBlock, type MarketContext } from "./context.ts";
import {
	parseRecommendation,
	type ParseResult,
	type RecommendationRequest,
} from "./recommendation.ts";
import {
	FALLBACK_SOURCE,
	templateFallback,
	type RecommendationSource,
} from "./fallback.ts";
import { validate, type ChainState, type Violation } from "./validate.ts";

// Matches SlotAssignment in recommendation.ts — the slots that exist on the
// deployed router, nothing else. (An earlier draft described the old six-slot
// grammar here; the model dutifully produced unparseable output shaped like it.)
const OUTPUT_SCHEMA = `Return ONLY a JSON object (no markdown fences, no prose), shaped exactly:
{
  "schema": "sluice.recommendation/1",
  "chainId": <number>,
  "observedAt": <number>,
  "observedBlock": <number>,
  "strategies": [
    {
      "templateId": "<a seed template id>",
      "slots": {
        "band":     { "instruction": "XYC_CONCENTRATE_GROW_LIQUIDITY_2D", "params": { "bandBps": <integer> } }, // optional
        "fee":      { "instruction": "FLAT_FEE_AMOUNT_IN_XD", "params": { "feeBps": <integer> } },              // optional
        "curve":    { "instruction": "XYC_SWAP_XD" },
        "deadline": { "deadline": <unix seconds> }
      },
      "tokens": ["<token address>", ...],          // canonical ASCENDING address order
      "virtualAmounts": ["<decimal string>", ...]  // aligned with tokens; NEVER a number
    }
  ]
}`;

// F2 §9: promptVersion goes into every trace. When the composer behaves
// differently at hour 30 than at hour 14, "we edited the prompt" is the most
// likely answer — unanswerable unless the version is recorded. Version 1 was
// the app-side six-section contract deleted in PR #30; this builder succeeds
// it. Bump on ANY change to the framing below, grammarPromptBlock() or
// contextPromptBlock().
export const PROMPT_VERSION = "sluice.compose/2";

export function buildComposeMessages(
	req: RecommendationRequest,
	ctx: MarketContext,
	extra?: string,
): ChatMessage[] {
	const system = [
		"You are Sluice's strategy composer for 1inch Aqua / SwapVM.",
		"You do NOT write bytecode. You choose which instructions fill a fixed program shape, and their parameters; a deterministic compiler owns the byte layout and the ordering.",
		"",
		grammarPromptBlock(),
		"",
		OUTPUT_SCHEMA,
		"",
		"Rules: no chain-of-thought, no tool use, no explanation in the output — the JSON object only.",
	].join("\n");

	const budgetLines = req.budget
		.map((b) => `  ${b.symbol} (${b.address}): up to ${b.amount}`)
		.join("\n");

	// Concrete values the model must ECHO, not invent. Without these a small model
	// fabricates a chainId (it defaulted to 1) and a deadline off some training-era
	// "now" — both rejected by the validator (I4, I7) on every attempt. State them.
	const now = ctx.observedAt;
	const deadlineMax = now + req.maxDeadlineSec;

	const user = [
		`USER PROMPT: ${req.prompt}`,
		"",
		"BUDGET (a ceiling the user set — never exceed, per token):",
		budgetLines,
		"",
		`maxStrategies: ${req.maxStrategies} | maxDeadlineSec: ${req.maxDeadlineSec}`,
		"",
		"REQUIRED FIXED FIELDS — copy these EXACTLY into your JSON; do NOT invent them:",
		`  chainId: ${BASE_CHAIN_ID}   (Base mainnet — the one venue every strategy ships to)`,
		`  observedAt: ${now}`,
		`  observedBlock: ${ctx.observedBlock}`,
		`  now (current unix time) is ${now}. Every strategy's deadline MUST be a unix timestamp`,
		`  in (now, now + maxDeadlineSec] = (${now}, ${deadlineMax}]; use ${deadlineMax} unless a shorter one is intended.`,
		"",
		contextPromptBlock(ctx),
		extra
			? `\nPREVIOUS ATTEMPT WAS REJECTED — fix these and return valid JSON only:\n${extra}`
			: "",
	].join("\n");

	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
}

export type ComposeResult = {
	parse: ParseResult;
	raw: InferResult; // the underlying 0G response (unverified, by scope)
	attempts: number;
	// The validator verdict on the LAST model attempt. Empty when an ENCLAVE
	// result was accepted; on TEMPLATE_FALLBACK it records the invariants the
	// final model output violated — the reason the run fell back.
	violations: Violation[];
	// How the returned recommendation was produced. ENCLAVE = the model's
	// output; TEMPLATE_FALLBACK = the deterministic seed used because inference
	// never produced a well-formed, valid one. Never blurred — see fallback.ts.
	source: RecommendationSource;
	// The messages actually used for the LAST inference attempt (the retry's,
	// if there was one) — never rebuilt after the fact, so a caller cannot
	// present a first-attempt reconstruction as "what was sent" when the real
	// last attempt carried the rejection-feedback suffix. Something was always
	// sent by the time this is populated, including on the internal
	// TEMPLATE_FALLBACK below (the retries were exhausted, not skipped).
	messages: ChatMessage[];
};

// The venue we ship to. The recommendation targets Base regardless of the 0G
// inference chain in `cfg`; the address book lives in config/addresses.8453.json.
export const BASE_CHAIN_ID = 8453;

// One infer + parse + validate round is one attempt. Bounded so a model that
// cannot produce a valid output falls through to the deterministic fallback
// rather than looping — every retry is a round trip the user waits on.
export const MAX_COMPOSE_ATTEMPTS = 2;

// The inference seam. Real runs use inferChat (the 0G round-trip); tests inject
// a fake so the loop is exercised without a broker, network, or signature fetch.
export type InferFn = (
	broker: ZGBroker,
	cfg: Config,
	messages: ChatMessage[],
) => Promise<InferResult>;

// The live chain facts the validator needs, derived from the context the
// composer already holds: the snapshot's block is the freshness reference and
// its time bounds the deadline. chainId is the venue we ship to, not the 0G
// inference chain. Pure — no chain read.
export function chainStateFor(
	ctx: MarketContext,
	chainId: number = BASE_CHAIN_ID,
): ChainState {
	return { chainId, headBlock: ctx.observedBlock, now: ctx.observedAt };
}

export async function compose(
	broker: ZGBroker,
	cfg: Config,
	req: RecommendationRequest,
	ctx: MarketContext,
	opts: { infer?: InferFn; chainState?: ChainState } = {},
): Promise<ComposeResult> {
	const infer = opts.infer ?? inferChat;
	const chainState = opts.chainState ?? chainStateFor(ctx);

	let raw!: InferResult;
	let parse!: ParseResult;
	let messages!: ChatMessage[];
	let violations: Violation[] = [];
	let feedback: string | undefined; // rejection notes handed to the next attempt
	let attempts = 0;

	while (attempts < MAX_COMPOSE_ATTEMPTS) {
		messages = buildComposeMessages(req, ctx, feedback);
		raw = await infer(broker, cfg, messages);
		parse = parseRecommendation(raw.resultText, req);
		attempts += 1;

		// Malformed shape: nothing to validate. Hand back the structural errors.
		if (!parse.ok || !parse.recommendation) {
			violations = [];
			feedback = parse.errors.join("; ");
			continue;
		}

		// Well-formed: the deterministic gate decides. No violations → accept.
		violations = validate(parse.recommendation, req, chainState);
		if (violations.length === 0) {
			return { parse, raw, attempts, violations, source: "ENCLAVE", messages };
		}
		// Rejected, never rewritten (F2 §4): feed the invariants back and re-infer.
		feedback = violations.map((v) => `${v.code}: ${v.message}`).join("; ");
	}

	// Attempts spent and the last model output was still malformed or violating:
	// deterministic template fallback, clearly labelled — never a model output.
	// `raw`, `violations` and `messages` keep the last rejected attempt for
	// the trace.
	const rec = templateFallback(req, ctx);
	parse = parseRecommendation(JSON.stringify(rec), req);
	return { parse, raw, attempts, violations, source: FALLBACK_SOURCE, messages };
}
