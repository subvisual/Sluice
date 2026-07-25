// Server-only facade for the app (design: docs/superpowers/specs/
// 2026-07-25-app-server-compose-design.md). The app's ONE import from this
// package on the server. Owns: env config, a broker singleton, live-book
// context, compose(), and the validator. It NEVER funds the ledger — funding
// is `npm run fund`, out-of-band — and every failure returns a labelled
// TEMPLATE_FALLBACK instead of throwing, so a missing key or a 0G outage is
// a degraded answer, not a dead screen.

import { ethers } from "ethers";
import { loadConfig, type Config } from "./config.ts";
import { initBroker, type ChatMessage, type ZGBroker } from "./inference.ts";
import { compose } from "./compose.ts";
import { liveContext, stubContext, type MarketContext } from "./context.ts";
import { FALLBACK_SOURCE, templateFallback, type RecommendationSource } from "./fallback.ts";
import type {
	RecommendationRequest,
	StrategyRecommendation,
	TokenBudget,
} from "./recommendation.ts";
import {
	DEFAULT_MAX_BLOCK_LAG,
	validate,
	type ChainState,
	type Violation,
} from "./validate.ts";

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
// computed from it would already be in the past. Re-key it to now.
function nowContext(): MarketContext {
	return { ...stubContext(), observedAt: Math.floor(Date.now() / 1000) };
}

function chainState(ctx: MarketContext): ChainState {
	return {
		chainId: 8453,
		headBlock: ctx.observedBlock,
		now: Math.floor(Date.now() / 1000),
		maxBlockLag: DEFAULT_MAX_BLOCK_LAG,
	};
}

function fallbackResult(req: RecommendationRequest, reason: string): ServerComposeResult {
	const ctx = nowContext();
	const rec = templateFallback(req, ctx);
	const violations = validate(rec, req, chainState(ctx));
	return {
		source: FALLBACK_SOURCE,
		reason,
		recommendation: rec,
		messages: null,
		proof: null,
		validation: { ok: violations.length === 0, violations },
		attempts: 0,
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

	// No key: short-circuit BEFORE any network call so this path is offline.
	if (!process.env.ZG_PRIVATE_KEY?.trim()) {
		return fallbackResult(
			req,
			"ZG_PRIVATE_KEY is not configured — deterministic template seed; nothing was sent to 0G",
		);
	}

	// Live book (F3 job 1); the subgraph being down degrades the context, not
	// the request — the prompt admits a stub book rather than inventing one.
	let ctx: MarketContext;
	try {
		ctx = await liveContext(input.user);
	} catch {
		ctx = nowContext();
	}

	try {
		const cfg = loadConfig();
		const broker = await getBroker(cfg);
		const result = await compose(broker, cfg, req, ctx);
		// compose() guarantees a well-formed parse (its own fallback re-parses).
		const rec = result.parse.recommendation!;
		const violations = validate(rec, req, chainState(ctx));
		const fromEnclave = result.source === "ENCLAVE";
		return {
			source: result.source,
			reason: fromEnclave
				? null
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
			validation: { ok: violations.length === 0, violations },
			attempts: result.attempts,
		};
	} catch (e) {
		brokerPromise = null; // do not poison later requests
		const msg = e instanceof Error ? e.message : String(e);
		return fallbackResult(req, `inference failed: ${msg}`);
	}
}
