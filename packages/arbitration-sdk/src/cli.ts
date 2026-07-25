import "dotenv/config";
import { ethers } from "ethers";
import { loadConfig } from "./config.ts";
import { initBroker, ensureLedgerFunded, infer } from "./inference.ts";
import { formatOutput } from "./proof.ts";

async function readPrompt(): Promise<string> {
	const fromArgv = process.argv.slice(2).join(" ").trim();
	if (fromArgv) return fromArgv;
	// Fall back to stdin (e.g. `echo "…" | npm run infer`).
	if (process.stdin.isTTY) return "";
	const chunks: Buffer[] = [];
	for await (const c of process.stdin) chunks.push(c as Buffer);
	return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
	const prompt = await readPrompt();
	if (!prompt) {
		console.error(
			'Usage: npm run infer -- "your prompt"   (or pipe via stdin)',
		);
		process.exit(2);
	}

	const cfg = loadConfig();
	const provider = new ethers.JsonRpcProvider(cfg.rpc);
	const wallet = new ethers.Wallet(cfg.privateKey, provider);

	const broker = await initBroker(wallet);
	await ensureLedgerFunded(broker, cfg.depositZG);

	const result = await infer(broker, cfg, prompt);
	console.log(formatOutput(result));
	process.exit(result.verified ? 0 : 1);
}

main().catch((e) => {
	console.error("inference failed:", e instanceof Error ? e.message : e);
	process.exit(1);
});
