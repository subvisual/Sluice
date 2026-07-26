// Risk appetite, read from the user's own words (issue #24).
//
// Classifying it is deliberately NOT the model's job: mixing a classification
// task into a JSON-emission task raises the malformed-output rate. So we
// classify here, and the prompt hands the model a fact to condition on rather
// than a judgement to make.
//
// What this DOESN'T do: rate the risk of a recommendation (Gate 2's job,
// deferred). This only reads what the user asked for.

export type RiskAppetite = "conservative" | "neutral" | "aggressive";

// Word-boundary matched, lowercased. Multi-word phrases are matched as written.
// Deliberately small: every entry is a phrase users actually type.
const CONSERVATIVE = [
	"safe",
	"safely",
	"safest",
	"stable",
	"conservative",
	"cautious",
	"careful",
	"preserve",
	"protect",
	"low risk",
	"minimal risk",
	"don't want to lose",
	"dont want to lose",
];

const AGGRESSIVE = [
	"aggressive",
	"aggressively",
	"risky",
	"high risk",
	"degen",
	"max yield",
	"maximum yield",
	"maximise",
	"maximize",
	"chase",
	"yolo",
	"can stomach",
	"gamble",
];

// Whole-word (or whole-phrase) match, so "unsafe" does not read as "safe" and
// "maximise" does not fire on "maximised". Escaping is unnecessary — every
// entry above is letters, spaces and apostrophes.
function countMatches(haystack: string, needles: string[]): number {
	let n = 0;
	for (const needle of needles) {
		if (new RegExp(`(^|\\W)${needle}(\\W|$)`, "i").test(haystack)) n += 1;
	}
	return n;
}

/**
 * Classify the risk appetite a prompt expresses.
 *
 * Deliberately blunt: more conservative hits than aggressive means conservative,
 * and vice versa; a tie or no hits means neutral.
 *
 * KNOWN LIMITATION: no negation handling, so "not too risky" reads as aggressive.
 * Acceptable, because the output only shifts which band widths are SUGGESTED —
 * it never touches the budget or overrides a validator invariant, and the user
 * reviews the recommendation before signing.
 */
export function classifyRiskAppetite(prompt: string): RiskAppetite {
	const conservative = countMatches(prompt, CONSERVATIVE);
	const aggressive = countMatches(prompt, AGGRESSIVE);
	if (conservative > aggressive) return "conservative";
	if (aggressive > conservative) return "aggressive";
	return "neutral";
}

/// The one line the prompt carries. The legend is fixed; only the level moves.
export function appetitePromptBlock(appetite: RiskAppetite): string {
	return [
		`RISK APPETITE (derived deterministically from the user's words — do NOT re-infer it): ${appetite.toUpperCase()}`,
		"  conservative = prefer wider bands and lower fees; neutral = balanced;",
		"  aggressive = tighter bands are acceptable when the extra fill volume justifies them.",
	].join("\n");
}
