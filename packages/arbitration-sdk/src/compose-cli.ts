import "dotenv/config";
import { ethers } from "ethers";
import { loadConfig } from "./config.ts";
import { initBroker, ensureLedgerFunded } from "./inference.ts";
import { compose } from "./compose.ts";
import { stubContext, liveContext, tokenBySymbol } from "./context.ts";
import type { RecommendationRequest, TokenBudget } from "./recommendation.ts";

const USAGE = `Usage:
  npm run compose -- "<your prompt>" --budget WETH=2,USDC=1000 [--maker 0x..] [--max-strategies N] [--max-deadline SEC]

  --maker 0x..  reads that maker's REAL book from the Aqua subgraph and feeds it
                to the model (job 1). Omit it to run against the stub context.

Example:
  npm run compose -- "sell my ETH if it hits 3500" --budget WETH=2 --maker 0x471e8aad77a1a29335081850b4e34fa7863f762a`;

type Args = {
	prompt: string;
	budget: TokenBudget[];
	maker?: string;
	maxStrategies: number;
	maxDeadlineSec: number;
};

function parseArgs(argv: string[]): Args | { error: string } {
	const positional: string[] = [];
	let budgetRaw = "";
	let maker: string | undefined;
	let maxStrategies = 3;
	let maxDeadlineSec = 7 * 24 * 60 * 60; // 7 days

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--budget") budgetRaw = argv[++i] ?? "";
		else if (a === "--maker") maker = argv[++i]?.trim();
		else if (a === "--max-strategies") maxStrategies = Number(argv[++i]);
		else if (a === "--max-deadline") maxDeadlineSec = Number(argv[++i]);
		else positional.push(a);
	}

	const prompt = positional.join(" ").trim();
	if (!prompt) return { error: "missing prompt" };
	if (!budgetRaw) return { error: "missing --budget" };

	const budget: TokenBudget[] = [];
	for (const part of budgetRaw.split(",")) {
		const [sym, amt] = part.split("=");
		const token = tokenBySymbol((sym ?? "").trim());
		if (!token) return { error: `unknown token "${sym}" (known: WETH, USDC)` };
		if (!amt || !/^\d+(\.\d+)?$/.test(amt.trim())) {
			return { error: `bad amount for ${sym}: "${amt}"` };
		}
		budget.push({
			symbol: token.symbol,
			address: token.address,
			amount: amt.trim(),
		});
	}

	if (maker && !/^0x[0-9a-fA-F]{40}$/.test(maker))
		return { error: `bad --maker address: "${maker}"` };
	if (!Number.isFinite(maxStrategies) || maxStrategies < 1)
		return { error: "bad --max-strategies" };
	if (!Number.isFinite(maxDeadlineSec) || maxDeadlineSec < 1)
		return { error: "bad --max-deadline" };

	return { prompt, budget, maker, maxStrategies, maxDeadlineSec };
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	if ("error" in parsed) {
		console.error(`${parsed.error}\n\n${USAGE}`);
		process.exit(2);
	}

	const req: RecommendationRequest = {
		prompt: parsed.prompt,
		budget: parsed.budget,
		maxStrategies: parsed.maxStrategies,
		maxDeadlineSec: parsed.maxDeadlineSec,
	};

	const cfg = loadConfig();
	const provider = new ethers.JsonRpcProvider(cfg.rpc);
	const wallet = new ethers.Wallet(cfg.privateKey, provider);

	const broker = await initBroker(wallet);
	await ensureLedgerFunded(broker, cfg.depositZG);

	const ctx = parsed.maker ? await liveContext(parsed.maker) : stubContext();

	const { parse, raw, attempts, source, violations } = await compose(
		broker,
		cfg,
		req,
		ctx,
	);

	console.log(`prompt:  ${req.prompt}`);
	console.log(
		`budget:  ${req.budget.map((b) => `${b.symbol}=${b.amount}`).join(", ")}`,
	);
	console.log(
		`context: ${ctx.source}${ctx.source === "subgraph" ? ` (maker ${ctx.userBook.maker}, ${ctx.userBook.liveStrategyCount} live @ block ${ctx.observedBlock})` : " (no live book)"}`,
	);
	console.log(
		`0G:      model responded in ${raw.latencyMs}ms (attempt ${attempts}, chatID ${raw.chatID || "n/a"})`,
	);
	console.log(`source:  ${source}`);
	if (source === "TEMPLATE_FALLBACK") {
		console.log(
			"         ⚠ inference did not yield a valid recommendation; this is a DETERMINISTIC template, NOT a model output.",
		);
		if (violations.length) {
			console.log("         last model attempt was rejected by the validator:");
			for (const v of violations)
				console.log(`           ✗ ${v.code}: ${v.message}`);
		}
	}
	console.log("");

	if (parse.ok && parse.recommendation) {
		const label =
			source === "TEMPLATE_FALLBACK"
				? "recommendation (TEMPLATE_FALLBACK — deterministic, NOT a model output):"
				: "recommendation (grammar-shaped, NOT compiled/verified):";
		console.log(label);
		console.log(JSON.stringify(parse.recommendation, null, 2));
	} else {
		console.log("could not parse a well-formed recommendation:");
		for (const e of parse.errors) console.log(`  ✗ ${e}`);
		console.log("\nraw model output:");
		console.log(raw.resultText);
	}

	if (parse.notes.length) {
		console.log("\nnotes:");
		for (const n of parse.notes) console.log(`  • ${n}`);
	}

	console.log(
		"\n(Recommendation is grammar-SHAPED per the provisional F1 §5 menu — not grammar-correct, not compiled, not shipped. Enclave signature received but not verified, by scope.)",
	);

	process.exit(parse.ok ? 0 : 1);
}

main().catch((e) => {
	console.error("compose failed:", e instanceof Error ? e.message : e);
	process.exit(1);
});
