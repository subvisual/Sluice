// The recommendation payload types and a LIGHT structural parse.
//
// Scope: this checks the model's output is well-FORMED (parseable, right shape,
// decimal-string amounts, tokens within the stated budget). It is NOT the F2
// I1–I14 validator and makes no claim about grammar-correctness, compilability,
// or safety — those are out of scope. Unknown opcode names are surfaced as
// soft notes, not hard failures, because the F1 grammar itself is provisional.

import { SWAP_LOGIC_OPTIONS, INVALIDATION_OPTIONS } from "./grammar.ts";

export type TokenBudget = {
	symbol: string;
	address: string;
	amount: string; // decimal string; never a JS number
};

export type RecommendationRequest = {
	prompt: string;
	budget: TokenBudget[];
	maxStrategies: number;
	maxDeadlineSec: number;
};

// A single slot value: an instruction name plus optional parameters.
export type Slot = { instruction: string; params?: Record<string, unknown> };

export type SlotAssignment = {
	templateId: string;
	slots: {
		balances: Slot;
		fees?: Slot;
		swapLogic: Slot;
		oracleAdjust?: Slot;
		invalidation: Slot;
		deadline: { deadline: number };
	};
	tokens: string[]; // addresses, canonical order
	virtualAmounts: string[]; // decimal strings, aligned with tokens
};

export type StrategyRecommendation = {
	schema: "sluice.recommendation/1";
	chainId: number;
	observedAt: number;
	observedBlock: number;
	strategies: SlotAssignment[];
};

export type ParseResult = {
	ok: boolean; // false only when the text is not usable at all
	recommendation?: StrategyRecommendation;
	errors: string[]; // structural problems that make it unusable
	notes: string[]; // soft observations (e.g. unknown opcode) — not failures
};

const DECIMAL = /^\d+(\.\d+)?$/;

// Strip markdown fences and any prose around the JSON object.
function extractJson(text: string): string {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
	return t;
}

export function parseRecommendation(
	text: string,
	req?: RecommendationRequest,
): ParseResult {
	const errors: string[] = [];
	const notes: string[] = [];

	let obj: any;
	try {
		obj = JSON.parse(extractJson(text));
	} catch (e) {
		return {
			ok: false,
			errors: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`],
			notes,
		};
	}

	if (obj?.schema !== "sluice.recommendation/1") {
		notes.push(
			`schema was ${JSON.stringify(obj?.schema)}, expected "sluice.recommendation/1"`,
		);
	}
	if (!Array.isArray(obj?.strategies) || obj.strategies.length === 0) {
		return { ok: false, errors: ["`strategies` is missing or empty"], notes };
	}

	const budgetByAddr = new Map<string, number>();
	if (req) {
		for (const b of req.budget)
			budgetByAddr.set(b.address.toLowerCase(), Number(b.amount));
	}

	obj.strategies.forEach((s: any, i: number) => {
		const at = `strategies[${i}]`;
		if (!s?.slots?.swapLogic?.instruction)
			errors.push(`${at}: missing slots.swapLogic.instruction`);
		if (!s?.slots?.invalidation?.instruction)
			errors.push(`${at}: missing slots.invalidation.instruction`);
		if (typeof s?.slots?.deadline?.deadline !== "number")
			errors.push(`${at}: missing slots.deadline.deadline`);

		if (!Array.isArray(s?.tokens) || !Array.isArray(s?.virtualAmounts)) {
			errors.push(`${at}: tokens/virtualAmounts must be arrays`);
			return;
		}
		if (s.tokens.length !== s.virtualAmounts.length) {
			errors.push(`${at}: tokens and virtualAmounts length mismatch`);
		}
		for (const a of s.virtualAmounts) {
			if (typeof a !== "string" || !DECIMAL.test(a)) {
				errors.push(
					`${at}: virtualAmount ${JSON.stringify(a)} is not a decimal string`,
				);
			}
		}

		// Soft notes — provisional grammar, so unknown names don't fail the run.
		const sl = s?.slots?.swapLogic?.instruction;
		if (sl && !SWAP_LOGIC_OPTIONS.includes(sl))
			notes.push(`${at}: swapLogic "${sl}" is not in the grammar menu`);
		const inv = s?.slots?.invalidation?.instruction;
		if (inv && !INVALIDATION_OPTIONS.includes(inv))
			notes.push(`${at}: invalidation "${inv}" is not in the grammar menu`);

		// Budget containment (soft-ish): flag tokens outside the budget or amounts over it.
		if (req) {
			s.tokens.forEach((tok: any, k: number) => {
				const addr = String(tok).toLowerCase();
				if (!budgetByAddr.has(addr)) {
					notes.push(`${at}: token ${tok} was not in the stated budget`);
					return;
				}
				const amt = Number(s.virtualAmounts[k]);
				const cap = budgetByAddr.get(addr)!;
				if (Number.isFinite(amt) && amt > cap) {
					notes.push(
						`${at}: amount ${s.virtualAmounts[k]} for ${tok} exceeds budget ${cap}`,
					);
				}
			});
		}
	});

	if (obj.strategies.length > (req?.maxStrategies ?? Infinity)) {
		notes.push(
			`returned ${obj.strategies.length} strategies, over maxStrategies ${req?.maxStrategies}`,
		);
	}

	return {
		ok: errors.length === 0,
		recommendation:
			errors.length === 0 ? (obj as StrategyRecommendation) : undefined,
		errors,
		notes,
	};
}
