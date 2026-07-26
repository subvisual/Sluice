/**
 * T0.5 spike — does showing the model a worked BASELINE answer buy compliance,
 * and what does it cost in parroting? (issue #28)
 *
 * The hypothesis: a 7B complies far better when it edits a known-good object
 * than when it composes one from a schema description. We already generate
 * exactly such an object — `templateFallback()` — deterministically, from this
 * request's own values.
 *
 * The risk being measured: if the model just returns the baseline, we are
 * paying enclave latency and ledger spend for fallback-quality output labelled
 * ENCLAVE. The `source` label stays honest either way, but "the model adds
 * value" would not be.
 *
 * ── Two arms ────────────────────────────────────────────────────────────────
 *   control   the production prompt, exactly as buildComposeMessages emits it
 *   baseline  the same prompt with a worked baseline object appended
 *
 * The spike appends the baseline to the user message ITSELF rather than adding
 * a flag to the production builder — the arms belong to the experiment, not to
 * `compose.ts`. It therefore re-implements the reject-and-re-infer loop in
 * miniature (~20 lines, `runOne` below). That duplication is deliberate: the
 * spike must be able to vary the loop without touching the shipped one.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 *   cd packages/arbitration-sdk
 *   npx tsx spike/baseline-anchoring.ts --dry-run     # no key, no network
 *   ZG_PRIVATE_KEY=0x... npx tsx spike/baseline-anchoring.ts
 *   ZG_PRIVATE_KEY=0x... npx tsx spike/baseline-anchoring.ts --limit 4
 *
 * COST: 24 requests x 2 arms x up to 2 attempts = up to 96 live inferences.
 * Fund the ledger first (`npm run fund`); this script never funds. Use --limit
 * to rehearse on a handful before spending the lot.
 *
 * --dry-run answers canned responses (one malformed, one verbatim-baseline
 * parrot, one good, one over-budget-then-corrected) so the harness, the parrot
 * comparator and the echo checks are all exercised without a key. It proves the
 * pipeline; it cannot tell you anything about the model.
 *
 * ── The gate (issue #28) ────────────────────────────────────────────────────
 * Adopt only if BOTH: malformed+violation rate drops >= 30% relative, AND the
 * parrot rate stays below ~1 in 3 accepted runs. Either way the numbers and the
 * go/no-go go to Notion F2 §9, and promptVersion bumps if adopted.
 */

// Entrypoint, so it loads .env itself — config.ts deliberately does not (PR #30
// moved dotenv to the entrypoints so the library is importable from the app's
// server runtime, which supplies env its own way). Same line as every CLI here.
import "dotenv/config";
import { ethers } from "ethers";
import { loadConfig } from "../src/config.ts";
import {
	initBroker,
	inferChat,
	type ChatMessage,
	type ZGBroker,
} from "../src/inference.ts";
import {
	buildComposeMessages,
	chainStateFor,
	MAX_COMPOSE_ATTEMPTS,
} from "../src/compose.ts";
import { stubContext, TOKENS, type MarketContext } from "../src/context.ts";
import { templateFallback } from "../src/fallback.ts";
import { pairingPlan } from "../src/pairing.ts";
import { bandTiers } from "../src/tiers.ts";
import { classifyRiskAppetite } from "../src/appetite.ts";
import {
	parseRecommendation,
	type RecommendationRequest,
	type StrategyRecommendation,
} from "../src/recommendation.ts";
import { validate, type Violation } from "../src/validate.ts";
import type { InferResult } from "../src/proof.ts";

// A frozen context, deliberately: the experiment varies the PROMPT, so the
// market and book must not move underneath the arms. (Real runs use
// liveContext; that would make the two arms incomparable.)
const CTX: MarketContext = stubContext();

/* ------------------------------------------------------------ request set */

const WETH = TOKENS.WETH.address;
const USDC = TOKENS.USDC.address;

const PROMPTS = [
	"market-make WETH/USDC for the week",
	"keep it safe, I don't want to lose my stack",
	"max yield, I can stomach a drawdown",
	"earn a spread on my stables, nothing fancy",
	"concentrate around the current price",
	"put my USDC to work",
];

const BUDGETS: Array<{ tag: string; budget: RecommendationRequest["budget"] }> = [
	{
		tag: "pair",
		budget: [
			{ symbol: "WETH", address: WETH, amount: "2" },
			{ symbol: "USDC", address: USDC, amount: "3000" },
		],
	},
	// Single-token: no pairing block is rendered, so this arm also measures
	// whether the model invents a counterpart token when we do not give it one.
	{ tag: "single", budget: [{ symbol: "USDC", address: USDC, amount: "1000" }] },
];

const MAX_STRATEGIES = [3, 1];

export type SpikeRequest = {
	id: string;
	appetite: string;
	req: RecommendationRequest;
};

export function requestSet(): SpikeRequest[] {
	const out: SpikeRequest[] = [];
	for (const prompt of PROMPTS) {
		for (const b of BUDGETS) {
			for (const maxStrategies of MAX_STRATEGIES) {
				out.push({
					id: `${b.tag}/${maxStrategies}/${prompt.slice(0, 24)}`,
					appetite: classifyRiskAppetite(prompt),
					req: {
						prompt,
						budget: b.budget,
						maxStrategies,
						maxDeadlineSec: 604_800,
					},
				});
			}
		}
	}
	return out; // 6 x 2 x 2 = 24
}

/* ---------------------------------------------------------- the two arms */

export type Arm = "control" | "baseline";

/**
 * The baseline block: a worked, VALID answer for this exact request.
 *
 * Built from the live request rather than written by hand — a static example
 * would hand the model stale constants to echo, which is the chainId/deadline
 * fabrication `compose.ts` already had to fix once.
 */
export function baselineBlock(
	req: RecommendationRequest,
	ctx: MarketContext,
): string {
	const seed = templateFallback(req, ctx);
	return [
		"",
		"BASELINE — a valid, conservative answer for THIS request, already checked.",
		"Improve on it where the user's intent calls for something better (band width,",
		"fee, how the budget is split, which template). If you cannot improve on it,",
		"returning it unchanged is an acceptable answer.",
		JSON.stringify(seed, null, 2),
	].join("\n");
}

function messagesFor(
	arm: Arm,
	req: RecommendationRequest,
	feedback?: string,
): ChatMessage[] {
	const msgs = buildComposeMessages(req, CTX, feedback);
	if (arm === "control") return msgs;
	// Append to the USER message, before nothing — the baseline is context for
	// the answer, and the rejection feedback (if any) is already inside `msgs`.
	const [system, user] = msgs;
	return [system, { ...user, content: user.content + baselineBlock(req, CTX) }];
}

/* ------------------------------------------------------------- comparators */

/// Key-sorted JSON with every deadline stripped — two recommendations that
/// differ only in expiry (or in whitespace) canonicalise to the same string.
export function canonical(rec: StrategyRecommendation): string {
	const strip = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(strip);
		if (v && typeof v === "object") {
			const o = v as Record<string, unknown>;
			return Object.keys(o)
				.filter((k) => k !== "deadline")
				.sort()
				.reduce<Record<string, unknown>>((acc, k) => {
					acc[k] = strip(o[k]);
					return acc;
				}, {});
		}
		return v;
	};
	return JSON.stringify(strip(rec));
}

/// Did the model return the baseline we handed it? (Deadline/whitespace-blind.)
export function isParrot(
	rec: StrategyRecommendation,
	req: RecommendationRequest,
): boolean {
	return canonical(rec) === canonical(templateFallback(req, CTX));
}

export type EchoCheck = {
	/** Amounts we precomputed and asked it to copy (null = no pairing block). */
	amounts: boolean | null;
	/** bandBps taken from a suggested tier (null = no tier block). */
	tiers: boolean | null;
	/** Token addresses copied character-for-character from the budget. */
	addresses: boolean;
};

/**
 * Whether the model ECHOED what we computed for it — the assumption every Tier 0
 * change rests on, and the thing nobody has measured against a live 7B.
 *
 * Deliberately generous: an amount counts as echoed if ANY strategy uses the
 * per-strategy share we published, because a model that echoes two of three
 * legs is a different animal from one that ignores the block entirely.
 */
export function echoChecks(
	rec: StrategyRecommendation,
	req: RecommendationRequest,
): EchoCheck {
	const tiered = req.maxStrategies >= 3;
	const plan = pairingPlan(CTX, req, tiered ? 3 : 1);
	const allAmounts = rec.strategies.flatMap((s) => s.virtualAmounts);
	const allBands = rec.strategies.map((s) => Number(s.slots?.band?.params?.bandBps));

	const suggested = tiered
		? bandTiers(
				CTX.pair.realizedVol7dPct,
				req.maxDeadlineSec,
				classifyRiskAppetite(req.prompt),
			).map((t) => t.bandBps)
		: [];

	const budgetAddrs = new Set(req.budget.map((b) => b.address));
	return {
		amounts: plan
			? plan.legs.some((l) => allAmounts.includes(l.perStrategy))
			: null,
		tiers: tiered ? allBands.some((b) => suggested.includes(b)) : null,
		// Exact, not case-insensitive: a checksummed-vs-lowercased answer still
		// resolves on-chain, so this measures copying fidelity, not correctness.
		addresses: rec.strategies.every((s) =>
			s.tokens.every((t) => budgetAddrs.has(t)),
		),
	};
}

/* --------------------------------------------------------------- the loop */

export type RunResult = {
	id: string;
	arm: Arm;
	attempts: number;
	accepted: boolean;
	malformedAttempts: number;
	violationCodes: string[];
	/** Why the run ended without an accepted answer. Null when it was accepted. */
	failureKind: "malformed" | "violation" | null;
	/** The last rejection text, for eyeballing what the model actually did. */
	lastError: string | null;
	parrot: boolean | null;
	echo: EchoCheck | null;
	latencyMs: number;
	promptChars: number;
	completionChars: number;
};

type InferFn = (messages: ChatMessage[]) => Promise<InferResult>;

async function runOne(
	arm: Arm,
	item: SpikeRequest,
	infer: InferFn,
): Promise<RunResult> {
	const chainState = chainStateFor(CTX);
	let feedback: string | undefined;
	let attempts = 0;
	let malformedAttempts = 0;
	let latencyMs = 0;
	let promptChars = 0;
	let completionChars = 0;
	let violations: Violation[] = [];

	while (attempts < MAX_COMPOSE_ATTEMPTS) {
		const messages = messagesFor(arm, item.req, feedback);
		promptChars = messages.reduce((n, m) => n + m.content.length, 0);
		const raw = await infer(messages);
		attempts += 1;
		latencyMs += raw.latencyMs;
		completionChars = raw.resultText.length;

		const parse = parseRecommendation(raw.resultText, item.req);
		if (!parse.ok || !parse.recommendation) {
			malformedAttempts += 1;
			feedback = parse.errors.join("; ");
			violations = [];
			continue;
		}
		violations = validate(parse.recommendation, item.req, chainState);
		if (violations.length === 0) {
			return {
				id: item.id,
				arm,
				attempts,
				accepted: true,
				malformedAttempts,
				violationCodes: [],
				failureKind: null,
				lastError: null,
				parrot: isParrot(parse.recommendation, item.req),
				echo: echoChecks(parse.recommendation, item.req),
				latencyMs,
				promptChars,
				completionChars,
			};
		}
		feedback = violations.map((v) => `${v.code}: ${v.message}`).join("; ");
	}

	return {
		id: item.id,
		arm,
		attempts,
		accepted: false,
		malformedAttempts,
		violationCodes: violations.map((v) => v.code),
		failureKind: violations.length > 0 ? "violation" : "malformed",
		lastError: feedback ?? null,
		parrot: null,
		echo: null,
		latencyMs,
		promptChars,
		completionChars,
	};
}

/* ------------------------------------------------------------- the report */

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

function armSummary(rows: RunResult[]) {
	const n = rows.length;
	const accepted = rows.filter((r) => r.accepted);
	const parrots = accepted.filter((r) => r.parrot);
	const echoed = (pick: (e: EchoCheck) => boolean | null) => {
		const applicable = accepted.filter((r) => r.echo && pick(r.echo) !== null);
		const hit = applicable.filter((r) => pick(r.echo!) === true);
		return `${pct(hit.length, applicable.length)} (${hit.length}/${applicable.length})`;
	};
	return {
		runs: n,
		accepted: `${pct(accepted.length, n)} (${accepted.length}/${n})`,
		fellBack: `${pct(n - accepted.length, n)}`,
		malformed: `${pct(rows.reduce((s, r) => s + r.malformedAttempts, 0), rows.reduce((s, r) => s + r.attempts, 0))} of attempts`,
		firstTry: pct(accepted.filter((r) => r.attempts === 1).length, n),
		parrotRate: `${pct(parrots.length, accepted.length)} (${parrots.length}/${accepted.length})`,
		echoAmounts: echoed((e) => e.amounts),
		echoTiers: echoed((e) => e.tiers),
		echoAddresses: echoed((e) => e.addresses),
		avgLatencyMs: Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / (n || 1)),
		avgPromptTokensEst: Math.round(
			rows.reduce((s, r) => s + r.promptChars, 0) / (n || 1) / 4,
		),
	};
}

function report(rows: RunResult[]): void {
	const control = armSummary(rows.filter((r) => r.arm === "control"));
	const baseline = armSummary(rows.filter((r) => r.arm === "baseline"));
	const keys = Object.keys(control) as Array<keyof typeof control>;

	console.log("\n| metric | control | baseline |");
	console.log("| --- | --- | --- |");
	for (const k of keys) {
		console.log(`| ${k} | ${control[k]} | ${baseline[k]} |`);
	}

	// The gate, evaluated rather than eyeballed — the numbers decide, not the
	// person who hoped the idea would work.
	const badness = (rows_: RunResult[]) => {
		const rs = rows_.filter((r) => r.arm !== undefined);
		const attempts = rs.reduce((s, r) => s + r.attempts, 0);
		const bad =
			rs.reduce((s, r) => s + r.malformedAttempts, 0) +
			rs.filter((r) => !r.accepted).length;
		return attempts === 0 ? 0 : bad / attempts;
	};
	const c = badness(rows.filter((r) => r.arm === "control"));
	const b = badness(rows.filter((r) => r.arm === "baseline"));
	const drop = c === 0 ? 0 : (c - b) / c;
	const acceptedBaseline = rows.filter((r) => r.arm === "baseline" && r.accepted);
	const parrotRate =
		acceptedBaseline.length === 0
			? 0
			: acceptedBaseline.filter((r) => r.parrot).length / acceptedBaseline.length;

	console.log(
		`\nGATE: malformed+fallback dropped ${Math.round(drop * 100)}% relative (bar: >= 30%), ` +
			`parrot rate ${Math.round(parrotRate * 100)}% (bar: < 33%)`,
	);
	console.log(
		drop >= 0.3 && parrotRate < 1 / 3
			? "=> ADOPT (then bump promptVersion, and record on Notion F2 §9)"
			: "=> DO NOT ADOPT (record the numbers on the issue and Notion F2 §9)",
	);
	// WHY runs failed. Without this the report says 75% fell back and gives
	// nobody a lead — and a spike that cannot say what broke is just an
	// expensive way to feel informed.
	for (const arm of ["control", "baseline"] as const) {
		const failed = rows.filter((r) => r.arm === arm && !r.accepted);
		if (failed.length === 0) continue;
		const codes = new Map<string, number>();
		for (const r of failed) {
			const keys =
				r.failureKind === "malformed" ? ["(malformed)"] : [...new Set(r.violationCodes)];
			for (const k of keys) codes.set(k, (codes.get(k) ?? 0) + 1);
		}
		const hist = [...codes.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => `${k}x${n}`)
			.join("  ");
		console.log(`\n${arm} failures (${failed.length}): ${hist}`);
		const sample = failed.find((r) => r.lastError);
		if (sample) console.log(`  e.g. ${sample.id}\n       ${sample.lastError?.slice(0, 300)}`);
	}

	console.log(
		"\nNOTE: token counts are chars/4 ESTIMATES — comparable between arms, not exact.",
	);
}

/* ----------------------------------------------------------------- drivers */

/// Pull the baseline object back out of the prompt we just built, so the
/// "parrot" answer is byte-for-byte what the model was shown. Slices from the
/// brace that OPENS the object — starting at `"schema"` would hand the parser a
/// fragment, which is a malformed answer wearing a parrot costume.
function baselineFromPrompt(userMsg: string): string | null {
	const at = userMsg.indexOf("BASELINE —");
	if (at === -1) return null;
	const open = userMsg.indexOf("{", at);
	const close = userMsg.lastIndexOf("}");
	return open !== -1 && close > open ? userMsg.slice(open, close + 1) : null;
}

/// Canned answers, so the harness proves itself without a key.
///
/// Keyed by RUN (not by a global call counter): each run walks a scripted pair
/// of attempts, so a single dry run exercises every path the report measures —
/// including the two a global counter can never produce, a first-attempt
/// success and an accepted parrot.
///
///   run % 4 == 0  malformed, then good      -> accepted on attempt 2
///   run % 4 == 1  the baseline, verbatim    -> accepted on attempt 1, PARROT
///   run % 4 == 2  over budget (I2), then good -> accepted on attempt 2
///   run % 4 == 3  good                      -> accepted on attempt 1
function dryRunInfer(run: number): InferFn {
	let attempt = 0;
	return async (messages) => {
		const n = attempt++;
		const userMsg = messages[messages.length - 1].content;
		// Recover the request this call belongs to, so the canned answers can be
		// built from its real budget (a fixed blob would fail I1 on every row).
		const isPair = userMsg.includes("WETH (");
		const seed = baselineFromPrompt(userMsg);
		const good = {
			schema: "sluice.recommendation/1",
			chainId: 8453,
			observedAt: CTX.observedAt,
			observedBlock: CTX.observedBlock,
			strategies: [
				{
					templateId: "full-range",
					slots: {
						curve: { instruction: "XYC_SWAP_XD" },
						deadline: { deadline: CTX.observedAt + 3600 },
					},
					tokens: isPair ? [WETH, USDC] : [USDC],
					virtualAmounts: isPair ? ["0.289855", "1000"] : ["100"],
				},
			],
		};
		const overBudget = JSON.stringify({
			...good,
			strategies: [
				{
					...good.strategies[0],
					virtualAmounts: isPair ? ["99", "99999"] : ["99999"],
				},
			],
		});
		const script: string[][] = [
			["sure! here is your strategy:", JSON.stringify(good)], // malformed, then good
			[seed ?? JSON.stringify(good), JSON.stringify(good)], // parrot (control arm has no seed)
			[overBudget, JSON.stringify(good)], // I2, then good
			[JSON.stringify(good), JSON.stringify(good)], // clean first try
		];
		const text = script[run % 4][Math.min(n, 1)];
		return {
			resultText: text,
			signedText: "",
			signature: "",
			signer: null,
			chatID: "dry-run",
			latencyMs: 1200,
			processResponseOk: false,
			verified: false,
			proofUrl: "",
		};
	};
}

function liveInfer(broker: ZGBroker, cfg: ReturnType<typeof loadConfig>): InferFn {
	return (messages) => inferChat(broker, cfg, messages);
}

async function main() {
	const dry = process.argv.includes("--dry-run");
	const limitArg = process.argv.indexOf("--limit");
	const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

	const items = requestSet().slice(0, limit);
	let live: InferFn | null = null;
	if (dry) {
		console.log("DRY RUN — canned responses. Proves the harness, not the model.\n");
	} else {
		const cfg = loadConfig();
		const wallet = new ethers.Wallet(
			cfg.privateKey,
			new ethers.JsonRpcProvider(cfg.rpc),
		);
		live = liveInfer(await initBroker(wallet), cfg);
		console.log(
			`LIVE — ${items.length} requests x 2 arms, up to ${MAX_COMPOSE_ATTEMPTS} attempts each. ` +
				`Ledger must already be funded (npm run fund).\n`,
		);
	}

	const rows: RunResult[] = [];
	let run = 0;
	for (const arm of ["control", "baseline"] as const) {
		for (const item of items) {
			const r = await runOne(arm, item, live ?? dryRunInfer(run));
			run += 1;
			rows.push(r);
			console.log(
				`${arm.padEnd(8)} ${r.accepted ? "ok  " : "FELL"} ${String(r.attempts)}x ` +
					`${r.parrot ? "PARROT " : "       "}${r.id}` +
					(r.accepted
						? ""
						: `  [${r.failureKind === "malformed" ? "malformed" : r.violationCodes.join(",")}]`),
			);
		}
	}
	report(rows);
}

// Executed directly, not imported by a test.
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
