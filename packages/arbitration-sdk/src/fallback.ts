// Deterministic template fallback.
//
// When sealed inference fails to produce a well-formed recommendation after its
// retries, we do NOT ship nothing and we do NOT ship an unvalidated model output
// — we emit a deterministic recommendation built from a seed template, labelled
// TEMPLATE_FALLBACK. Pure function of (request, context): no model, no network,
// no randomness, so the same inputs always yield identical bytes.
//
// It carries no enclave signature — the label is what keeps it from being
// presented as something the model said.

import { TEMPLATES, type Template } from "./grammar.ts";
import type { MarketContext } from "./context.ts";
import type {
	RecommendationRequest,
	SlotAssignment,
	StrategyRecommendation,
} from "./recommendation.ts";

// The source label that must travel with a fallback recommendation so nothing
// downstream mistakes it for a model output.
/// 0.05%. feeBps is out of 1e9, not 1e4 — see config/opcodes.8453.json.
const DEFAULT_FEE_BPS = 500_000;
/// 1%. Same 1e9 base. Wide enough a stable pair stays inside it for a while,
/// tight enough that the concentration visibly bites.
const DEFAULT_BAND_BPS = 10_000_000;

export const FALLBACK_SOURCE = "TEMPLATE_FALLBACK" as const;
export type RecommendationSource = "ENCLAVE" | typeof FALLBACK_SOURCE;

const tmpl = (id: string): Template => TEMPLATES.find((t) => t.id === id)!;

// Deterministic intent heuristic — a keyword match, not a model. It only has to
// pick a sane seed shape; a wrong guess is a suboptimal-but-valid
// recommendation, never an unsafe one.
export function selectTemplate(prompt: string): Template {
	const p = prompt.toLowerCase();
	// Two independent signals: earning a spread (fee) and concentrating around
	// the current price (band). "range" alone is NOT a band signal ("across the
	// whole range" is full-range intent), so the band match wants words that only
	// mean concentration.
	const wantsFee = /(\bfee\b|\bspread\b|\bearn\b|\byield\b|\bincome\b|\bprofit\b|\bcharge\b)/.test(p);
	const wantsBand = /(\btight\b|\bnarrow\b|concentrat|\bband\b|\brangebound\b|\bstable\b|around the (current )?price)/.test(p);
	if (wantsBand) return tmpl(wantsFee ? "banded-fee" : "banded");
	return tmpl(wantsFee ? "full-range-fee" : "full-range");
}

export function templateFallback(
	req: RecommendationRequest,
	ctx: MarketContext,
): StrategyRecommendation {
	const t = selectTemplate(req.prompt);

	const strategy: SlotAssignment = {
		templateId: t.id,
		slots: {
			curve: { instruction: t.curve },
			...(t.wrappers.includes("XYC_CONCENTRATE_GROW_LIQUIDITY_2D")
				? {
						band: {
							instruction: "XYC_CONCENTRATE_GROW_LIQUIDITY_2D",
							params: { bandBps: DEFAULT_BAND_BPS },
						},
					}
				: {}),
			...(t.wrappers.includes("FLAT_FEE_AMOUNT_IN_XD")
				? { fee: { instruction: "FLAT_FEE_AMOUNT_IN_XD", params: { feeBps: DEFAULT_FEE_BPS } } }
				: {}),
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
