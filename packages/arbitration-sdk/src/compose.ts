// Sealed composition: prompt + budget + context -> a grammar-shaped
// StrategyRecommendation, produced by a live 0G inference call.
//
// Scope: this is the "just get a recommendation" path. It reuses the Gate 0
// round-trip (inferChat) and receives the enclave signature, but does NOT
// verify it, commit it, or persist anything — verifiability is out of scope.
// One retry on malformed output; then the deterministic TEMPLATE_FALLBACK
// (Wiring §4 step 5b) so a run always yields a well-formed recommendation.
// The full validator-driven reject-and-re-infer loop is still Issue 5 (blocked
// on the F1 grammar).

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
      "tokens": ["<token address>", ...],          // canonical order
      "virtualAmounts": ["<decimal string>", ...]  // aligned with tokens; NEVER a number
    }
  ]
}`;

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

	const user = [
		`USER PROMPT: ${req.prompt}`,
		"",
		"BUDGET (a ceiling the user set — never exceed, per token):",
		budgetLines,
		"",
		`maxStrategies: ${req.maxStrategies} | maxDeadlineSec: ${req.maxDeadlineSec}`,
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
	// How the returned recommendation was produced. ENCLAVE = the model's
	// output; TEMPLATE_FALLBACK = the deterministic seed used because inference
	// never produced a well-formed one. Must never be blurred — see fallback.ts.
	source: RecommendationSource;
};

export async function compose(
	broker: ZGBroker,
	cfg: Config,
	req: RecommendationRequest,
	ctx: MarketContext,
): Promise<ComposeResult> {
	let raw = await inferChat(broker, cfg, buildComposeMessages(req, ctx));
	let parse = parseRecommendation(raw.resultText, req);
	let attempts = 1;

	// One retry on malformed output, handing back the structural errors.
	if (!parse.ok) {
		const messages = buildComposeMessages(req, ctx, parse.errors.join("; "));
		raw = await inferChat(broker, cfg, messages);
		parse = parseRecommendation(raw.resultText, req);
		attempts = 2;
	}

	// Retries exhausted and still not well-formed: fall back to a deterministic
	// template recommendation, clearly labelled — never presented as a model
	// output. `raw` still carries the last (rejected) model attempt for the trace.
	if (!parse.ok) {
		const rec = templateFallback(req, ctx);
		parse = parseRecommendation(JSON.stringify(rec), req);
		return { parse, raw, attempts, source: FALLBACK_SOURCE };
	}

	return { parse, raw, attempts, source: "ENCLAVE" };
}
