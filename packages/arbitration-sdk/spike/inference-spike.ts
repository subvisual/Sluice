/**
 * F2 Gate 0 — validate 0G sealed inference BEFORE building anything on top of it.
 *
 * This probe proves (or kills) every assumption ADR-0001 / ADR-0002 rest on:
 *   1. the ledger can be funded (capture the real deposit min + faucet reality)
 *   2. an inference round-trips and returns a chatID (ZG-Res-Key)
 *   3. the signature is fetchable out-of-band and is EIP-191 over the response TEXT
 *   4. verifyMessage(text, sig) recovers to a STABLE signer -> that's what we registerSigner
 *   5. the signed `text` is BYTE-FOR-BYTE the assistant content (no server normalization)
 *   6. the 7B can emit our 3-line framed decision (header + 20-digit epoch + JSON) — retry rate
 *   7. per-call latency (first I12 datapoint) + the Galileo chainId on the wallet
 *
 * If (4) or (5) differ from what we drafted, the codec/contract adjust before a line is written.
 *
 * Run:
 *   cd packages/arbitration-sdk
 *   npm i ethers @0gfoundation/0g-compute-ts-sdk tsx
 *   SPIKE_PRIVATE_KEY=0x... npx tsx spike/inference-spike.ts
 *
 * Env:
 *   SPIKE_PRIVATE_KEY   (required) a funded Galileo testnet key — faucet https://faucet.0g.ai
 *   ZG_RPC              default https://evmrpc-testnet.0g.ai
 *   ZG_PROVIDER         default 0xa48f01287233509FD694a22Bf840225062E67836 (qwen-2.5-7b)
 *   ZG_MODEL            default qwen/qwen-2.5-7b-instruct
 *   ZG_DEPOSIT          default 3   (0G to deposit into the compute ledger)
 *
 * NOTE: 0G moves fast. Where the live SDK surface differs from the names below, this script
 * PRINTS the failure and keeps going — the goal is a report, not a green checkmark. Adapt the
 * marked calls to whatever the installed SDK version exposes.
 */
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const RPC = process.env.ZG_RPC ?? "https://evmrpc-testnet.0g.ai";
const PROVIDER =
	process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836";
const MODEL = process.env.ZG_MODEL ?? "qwen/qwen-2.5-7b-instruct";
const DEPOSIT = Number(process.env.ZG_DEPOSIT ?? "3");
const KEY = process.env.SPIKE_PRIVATE_KEY;

const results: Record<string, string> = {};
const ok = (k: string, v = "yes") => (results[k] = `PASS — ${v}`);
const bad = (k: string, e: unknown) =>
	(results[k] = `FAIL — ${e instanceof Error ? e.message : String(e)}`);

// The exact 3-line frame the real decision will use (ADR-0001). We DICTATE lines 0-1.
const CHAIN_ID = 11155111; // DecisionRegistry lives on Ethereum Sepolia
const EPOCH = 42n;
const HEADER = `sluice.book-decision/1;chain=${CHAIN_ID}`;
const framePrompt = () =>
	`You output ONLY a decision, nothing else. Your response MUST be exactly three lines:\n` +
	`Line 1 (verbatim): ${HEADER}\n` +
	`Line 2 (verbatim): ${EPOCH.toString().padStart(20, "0")}\n` +
	`Line 3: a single-line JSON object {"maker":"0x0000000000000000000000000000000000000000","ship":[],"dock":[],"hold":[],"projected":[]}\n` +
	`No markdown fences, no prose, no extra lines.`;

async function main() {
	if (!KEY) throw new Error("set SPIKE_PRIVATE_KEY");
	const provider = new ethers.JsonRpcProvider(RPC);
	const wallet = new ethers.Wallet(KEY, provider);

	// 7. chainId on the wallet (briefing flags 16601 vs 16602)
	try {
		const net = await provider.getNetwork();
		ok("chainId", `Galileo reports ${net.chainId}`);
	} catch (e) {
		bad("chainId", e);
	}

	const broker = await createZGComputeNetworkBroker(wallet);

	// 1. fund the compute ledger — capture the REAL minimum
	try {
		await broker.ledger.depositFund(DEPOSIT); // ADAPT if the method name differs
		ok(
			"ledger.depositFund",
			`deposited ${DEPOSIT} 0G (confirm this >= real min)`,
		);
	} catch (e) {
		bad("ledger.depositFund", e);
	}

	// 2-3. metadata + one inference + fetch the signature
	let chatID = "",
		endpoint = "",
		assistantContent = "",
		signedText = "",
		signature = "";
	try {
		const meta = await broker.inference.getServiceMetadata(PROVIDER); // { endpoint, model }
		endpoint = meta.endpoint;
		const messages = [{ role: "user", content: framePrompt() }];
		const headers = await broker.inference.getRequestHeaders(
			PROVIDER,
			JSON.stringify(messages),
		); // single-use

		const t0 = Date.now();
		const res = await fetch(`${endpoint}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({ model: MODEL, messages }),
		});
		const latency = Date.now() - t0;
		const data: any = await res.json();
		assistantContent = data?.choices?.[0]?.message?.content ?? "";
		chatID =
			res.headers.get("ZG-Res-Key") ??
			res.headers.get("zg-res-key") ??
			data?.id ??
			"";
		ok("inference", `${latency}ms, chatID=${chatID.slice(0, 12)}…`);
		results["latency_ms(I12 datapoint)"] = String(latency);

		// 6. framing compliance — did the 7B emit our exact 3-line frame?
		const lines = assistantContent.split("\n");
		const framed = lines[0] === HEADER && /^\d{20}$/.test(lines[1] ?? "");
		results["framing_compliance"] = framed
			? "PASS — exact frame on attempt 1"
			: `WEAK — got:\n${assistantContent.slice(0, 160)}`;
	} catch (e) {
		bad("inference", e);
	}

	// 3. out-of-band signature fetch
	try {
		const url = `${endpoint}/v1/proxy/signature/${chatID}?model=${encodeURIComponent(MODEL)}`;
		const sigRes = await fetch(url);
		const sig: any = await sigRes.json();
		signedText = sig.text ?? "";
		signature = sig.signature ?? "";
		ok(
			"signature.fetch",
			`text ${signedText.length}B, sig ${signature.slice(0, 12)}…`,
		);
	} catch (e) {
		bad("signature.fetch", e);
	}

	// 4. EIP-191 recovery -> the address we will registerSigner (THE assertion)
	try {
		const recovered = ethers.verifyMessage(signedText, signature);
		ok("EIP-191.recover", `signer = ${recovered}  <-- registerSigner THIS`);
		results["REGISTER_THIS_SIGNER"] = recovered;
	} catch (e) {
		bad("EIP-191.recover", e);
	}

	// 5. byte-for-byte: is the SIGNED text identical to the content we received?
	//    If not, on-chain we must commit keccak256(SIGNED text), never the received content.
	try {
		const identical = signedText === assistantContent;
		results["text_byte_identical"] = identical
			? "PASS — signed text === received content"
			: `DIFFERS — server normalized. Use the SIGNED text everywhere (hash/parse/store). ` +
				`signedLen=${signedText.length} recvLen=${assistantContent.length}`;
	} catch (e) {
		bad("text_byte_identical", e);
	}

	// 6b. SDK's own verifier agrees
	try {
		const valid = await broker.inference.processResponse(PROVIDER, chatID);
		ok("processResponse", String(valid));
	} catch (e) {
		bad("processResponse", e);
	}

	console.log("\n=== F2 GATE 0 — 0G inference validation ===");
	for (const [k, v] of Object.entries(results))
		console.log(`  ${k.padEnd(28)} ${v}`);
	console.log(
		"\nGate passes iff EIP-191.recover PASSes with a stable signer AND you know",
	);
	console.log(
		"whether text_byte_identical PASS/DIFFERS. Everything else is data to record.\n",
	);
}

main().catch((e) => {
	console.error("SPIKE ABORTED:", e);
	process.exit(1);
});
