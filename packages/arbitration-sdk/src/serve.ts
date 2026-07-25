// Server-only facade for the app (design: docs/superpowers/specs/
// 2026-07-25-app-server-compose-design.md). The app's ONE import from this
// package on the server. Owns: env config, a broker singleton, live-book
// context, the request's wall clock, and compose() — whose re-infer loop runs
// the deterministic gate on the clock this facade supplies; the facade itself
// validates only the deterministic fallbacks it builds.
// It NEVER funds the ledger — funding
// is `npm run fund`, out-of-band — and every failure returns a labelled
// TEMPLATE_FALLBACK instead of throwing, so a missing key or a 0G outage is
// a degraded answer, not a dead screen.

import { ethers } from "ethers";
import { loadConfig, type Config } from "./config.ts";
import { initBroker, type ChatMessage, type ZGBroker } from "./inference.ts";
import { chainStateFor, compose, PROMPT_VERSION } from "./compose.ts";
import { liveContext, stubContext, type MarketContext } from "./context.ts";
import { FALLBACK_SOURCE, templateFallback, type RecommendationSource } from "./fallback.ts";
import type {
	RecommendationRequest,
	StrategyRecommendation,
	TokenBudget,
} from "./recommendation.ts";
import { validate, type ChainState, type Violation } from "./validate.ts";

export type ServerBudgetEntry = {
	address: string;
	symbol: string;
	decimals: number;
	/** Base units, integer decimal string — never a JS number. */
	amount: string;
};

export type ServerComposeInput = {
	user: string;
	prompt: string;
	budget: ServerBudgetEntry[];
	maxStrategies: number;
	maxDeadlineSec: number;
};

export type ServerComposeResult = {
	source: RecommendationSource;
	/** Non-null exactly when source is TEMPLATE_FALLBACK — the honest why. */
	reason: string | null;
	recommendation: StrategyRecommendation;
	/**
	 * The exact messages used for the LAST inference attempt (the retry's, if
	 * there was one) — never a reconstruction. Non-null whenever something was
	 * actually sent to the enclave, including the SDK-internal
	 * TEMPLATE_FALLBACK (inference was attempted and rejected — something WAS
	 * sent). Null only when nothing was ever sent: no `ZG_PRIVATE_KEY`, or the
	 * request failed before any call went out.
	 */
	messages: ChatMessage[] | null;
	/** Enclave proof material; null unless source is ENCLAVE. */
	proof: {
		signedText: string;
		signature: string;
		signer: string | null;
		verified: boolean;
		proofUrl: string;
		latencyMs: number;
	} | null;
	validation: { ok: boolean; violations: Violation[] };
	attempts: number;
	/**
	 * Where the BOOK context came from (F3 job 1): "subgraph" = the user's live
	 * book; "stub" = the subgraph was unavailable, or nothing was fetched at all
	 * (the no-key path). Surfaced so the UI can say so — F3's rule is
	 * stub-labelled end-to-end, and this response is the end.
	 */
	contextSource: MarketContext["source"];
	/** The prompt contract that produced this — F2 §9. */
	promptVersion: string;
};

export function budgetEntryToDecimal(e: ServerBudgetEntry): TokenBudget {
	return {
		symbol: e.symbol,
		address: e.address,
		amount: ethers.formatUnits(BigInt(e.amount), e.decimals),
	};
}

// One broker per process, reused across warm serverless invocations. Reset on
// failure so a transient RPC error does not poison every later request.
let brokerPromise: Promise<ZGBroker> | null = null;
function getBroker(cfg: Config): Promise<ZGBroker> {
	if (!brokerPromise) {
		const provider = new ethers.JsonRpcProvider(cfg.rpc);
		const wallet = new ethers.Wallet(cfg.privateKey, provider);
		brokerPromise = initBroker(wallet);
	}
	return brokerPromise;
}

// stubContext() is frozen in time for reproducible tests; a fallback deadline
// computed from it would already be in the past. Re-key it to the request's
// wall clock — the SAME `now` the validator uses, so the two can never drift
// across the second boundary between two Date.now() calls.
function nowContext(now: number): MarketContext {
	return { ...stubContext(), observedAt: now };
}

// The validator clock. observedAt/observedBlock are SNAPSHOT facts the model
// echoes; `now` is the server's wall clock, computed once per request.
// Validating on the snapshot's own clock (chainStateFor's default) can never
// catch a stale or degenerate snapshot — a lagging indexer, a null _meta
// timestamp — because the bound and the value share a source. headBlock still
// equals the snapshot block (a real head read needs a Base RPC this facade
// does not hold), so I12 stays inert here; I7 is the guard that becomes real.
function wallChainState(ctx: MarketContext, now: number): ChainState {
	return { ...chainStateFor(ctx), now };
}

function verdict(
	rec: StrategyRecommendation,
	req: RecommendationRequest,
	ctx: MarketContext,
	now: number,
): { ok: boolean; violations: Violation[] } {
	const violations = validate(rec, req, wallChainState(ctx, now));
	return { ok: violations.length === 0, violations };
}

function fallbackResult(
	req: RecommendationRequest,
	reason: string,
	now: number,
): ServerComposeResult {
	const ctx = nowContext(now);
	const rec = templateFallback(req, ctx);
	const { ok, violations } = verdict(rec, req, ctx, now);
	return {
		source: FALLBACK_SOURCE,
		reason,
		recommendation: rec,
		messages: null,
		proof: null,
		validation: { ok, violations },
		attempts: 0,
		contextSource: "stub",
		promptVersion: PROMPT_VERSION,
	};
}

export async function composeForApp(
	input: ServerComposeInput,
): Promise<ServerComposeResult> {
	// Canonical (ascending-address) order up front: the fallback and the model
	// both inherit it, so I10 never trips on input ordering.
	const sorted = [...input.budget].sort((a, b) =>
		a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1,
	);
	const req: RecommendationRequest = {
		prompt: input.prompt,
		budget: sorted.map(budgetEntryToDecimal),
		maxStrategies: input.maxStrategies,
		maxDeadlineSec: input.maxDeadlineSec,
	};

	// One wall clock per request: the prompt's snapshot may lag it slightly
	// (that is what observedAt is for), but every VALIDATION bound in this
	// request derives from this single number.
	const now = Math.floor(Date.now() / 1000);

	// No key: short-circuit BEFORE any network call so this path is offline.
	if (!process.env.ZG_PRIVATE_KEY?.trim()) {
		return fallbackResult(
			req,
			"ZG_PRIVATE_KEY is not configured — deterministic template seed; nothing was sent to 0G",
			now,
		);
	}

	// Live book (F3 job 1); the subgraph being down degrades the context, not
	// the request — the prompt admits a stub book rather than inventing one,
	// and `contextSource` carries the degradation into the response.
	let ctx: MarketContext;
	try {
		ctx = await liveContext(input.user);
	} catch {
		ctx = nowContext(now);
	}

	try {
		const cfg = loadConfig();
		const broker = await getBroker(cfg);
		const result = await compose(broker, cfg, req, ctx, {
			// Override the loop's default snapshot clock with the wall clock, so
			// the gate that ACCEPTS inside compose() is the same gate this facade
			// answers for — one clock, no accept-then-reject drift.
			chainState: wallChainState(ctx, now),
		});
		// compose() guarantees a well-formed parse (its own fallback re-parses).
		const rec = result.parse.recommendation!;
		const fromEnclave = result.source === "ENCLAVE";
		// compose() runs the deterministic gate inside its re-infer loop: an
		// ENCLAVE result is already gate-approved (empty violations), and
		// result.violations records what the LAST rejected model attempt
		// violated. The deterministic fallback rec compose() returns instead is
		// validated on its own merits here — the model attempt's violations
		// belong in `reason`, not in the verdict on what the user is shown.
		const validation = fromEnclave
			? { ok: true, violations: [] as Violation[] }
			: verdict(rec, req, ctx, now);
		return {
			source: result.source,
			reason: fromEnclave
				? null
				: result.violations.length > 0
					? `the deterministic gate rejected the model output after ${result.attempts} attempts (${result.violations.map((v) => v.code).join(", ")})`
					: `inference produced no well-formed recommendation after ${result.attempts} attempts`,
			recommendation: rec,
			messages: result.messages,
			proof: fromEnclave
				? {
						signedText: result.raw.signedText,
						signature: result.raw.signature,
						signer: result.raw.signer,
						verified: result.raw.verified,
						proofUrl: result.raw.proofUrl,
						latencyMs: result.raw.latencyMs,
					}
				: null,
			validation,
			attempts: result.attempts,
			contextSource: ctx.source,
			promptVersion: PROMPT_VERSION,
		};
	} catch (e) {
		brokerPromise = null; // do not poison later requests
		const msg = e instanceof Error ? e.message : String(e);
		return fallbackResult(req, `inference failed: ${msg}`, now);
	}
}
