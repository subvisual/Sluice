import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { computeVerified, type InferResult } from "./proof.ts";
import type { Config } from "./config.ts";

export type ZGBroker = Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;

export async function initBroker(wallet: ethers.Wallet): Promise<ZGBroker> {
	return createZGComputeNetworkBroker(wallet);
}

// Deposit into the compute ledger if the funded balance is below `minZG`.
// NOTE: method names here are drafted from the spike; reconcile in Task 4.
export async function ensureLedgerFunded(
	broker: ZGBroker,
	minZG: number,
): Promise<void> {
	await broker.ledger.depositFund(minZG);
}

export async function infer(
	broker: ZGBroker,
	cfg: Config,
	prompt: string,
): Promise<InferResult> {
	const meta = await broker.inference.getServiceMetadata(cfg.provider);
	const endpoint: string = meta.endpoint;

	const messages = [{ role: "user", content: prompt }];
	const headers = await broker.inference.getRequestHeaders(
		cfg.provider,
		JSON.stringify(messages),
	);

	const t0 = Date.now();
	const res = await fetch(`${endpoint}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ model: cfg.model, messages }),
	});
	const latencyMs = Date.now() - t0;
	const data: any = await res.json();

	const resultText: string = data?.choices?.[0]?.message?.content ?? "";
	const chatID: string =
		res.headers.get("ZG-Res-Key") ??
		res.headers.get("zg-res-key") ??
		data?.id ??
		"";

	const proofUrl = `${endpoint}/v1/proxy/signature/${chatID}?model=${encodeURIComponent(
		cfg.model,
	)}`;
	const sigRes = await fetch(proofUrl);
	const sigJson: any = await sigRes.json();
	const signedText: string = sigJson?.text ?? "";
	const signature: string = sigJson?.signature ?? "";

	let signer: string | null = null;
	try {
		signer = ethers.verifyMessage(signedText, signature);
	} catch {
		signer = null;
	}

	let processResponseOk = false;
	try {
		processResponseOk = Boolean(
			await broker.inference.processResponse(cfg.provider, chatID),
		);
	} catch {
		processResponseOk = false;
	}

	const verified = computeVerified(signer, processResponseOk);

	return {
		resultText,
		signedText,
		signature,
		signer,
		chatID,
		latencyMs,
		processResponseOk,
		verified,
		proofUrl,
	};
}
