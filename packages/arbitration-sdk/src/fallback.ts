// Deterministic template fallback.
//
// When sealed inference fails to produce a well-formed recommendation after
// its retries (F2 §4 / Wiring §4 step 5b), we do NOT ship nothing and we do
// NOT ship an unvalidated model output — we emit a deterministic recommendation
// built from a seed template, labelled TEMPLATE_FALLBACK. It is a pure function
// of (request, context): no model, no network, no randomness, so the same
// inputs always yield identical bytes.
//
// This is the "labelled, never a model output" half of Issue 6. It carries no
// enclave signature and makes no verifiability claim (out of current scope);
// the label is what keeps it from being presented as something the model said.

import { TEMPLATES, type Template } from "./grammar.ts";
import type { MarketContext } from "./context.ts";
import type {
	RecommendationRequest,
	SlotAssignment,
	StrategyRecommendation,
} from "./recommendation.ts";

// The source label that must travel with a fallback recommendation so nothing
// downstream mistakes it for a model output. See Wiring §6 (ENCLAVE vs
// TEMPLATE_FALLBACK) and F2 §8.
export const FALLBACK_SOURCE = "TEMPLATE_FALLBACK" as const;
export type RecommendationSource = "ENCLAVE" | typeof FALLBACK_SOURCE;

const tmpl = (id: string): Template => TEMPLATES.find((t) => t.id === id)!;

// Deterministic intent heuristic — a keyword match, not a model. It only has to
// pick a sane seed shape; the templates are known-good starting points, so a
// wrong guess is a suboptimal-but-valid recommendation, never an unsafe one.
export function selectTemplate(prompt: string): Template {
	const p = prompt.toLowerCase();
	// T3 — a level, executed all-or-nothing.
	if (
		/(all.at.once|all.or.nothing|\bif it (hits|reaches|gets)|\btarget\b|\blimit\b|\blevel\b|\bsell .* (at|if|when)\b)/.test(
			p,
		)
	) {
		return tmpl("T3");
	}
	// T2 — wide, uncertain about the range.
	if (
		/(\bwide\b|not confident|unsure|uncertain|\bexposure\b|not sure)/.test(p)
	) {
		return tmpl("T2");
	}
	// T1 — tight, rangebound flow capture (also the default).
	return tmpl("T1");
}

export function templateFallback(
	req: RecommendationRequest,
	ctx: MarketContext,
): StrategyRecommendation {
	const t = selectTemplate(req.prompt);

	const strategy: SlotAssignment = {
		templateId: t.id,
		slots: {
			balances: { instruction: "perTokenSetup" },
			swapLogic: { instruction: t.swapLogic },
			invalidation: { instruction: t.invalidation },
			// Within the request's bound (satisfies the composer's I7-style check).
			deadline: { deadline: ctx.observedAt + req.maxDeadlineSec },
		},
		// Draw strictly on what the user offered: their tokens, their amounts.
		tokens: req.budget.map((b) => b.address),
		virtualAmounts: req.budget.map((b) => b.amount),
	};

	return {
		schema: "sluice.recommendation/1",
		chainId: 8453,
		observedAt: ctx.observedAt,
		observedBlock: ctx.observedBlock,
		strategies: [strategy],
	};
}
