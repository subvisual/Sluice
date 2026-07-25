import { ethers } from "ethers";
import type { createZGComputeNetworkBroker as CreateBroker } from "@0gfoundation/0g-compute-ts-sdk";
import { createRequire } from "node:module";
import { computeVerified, type InferResult } from "./proof.ts";
import type { Config } from "./config.ts";

// FIX 1: the SDK's ESM build (lib.esm) throws at load under Node 22
// ("does not provide an export named 'C'"). The CommonJS build (lib.commonjs)
// loads cleanly, so pull the runtime value through createRequire while keeping
// the real type via `import type`.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } =
	require("@0gfoundation/0g-compute-ts-sdk") as {
		createZGComputeNetworkBroker: typeof CreateBroker;
	};

export type ZGBroker = Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;

export async function initBroker(wallet: ethers.Wallet): Promise<ZGBroker> {
	return createZGComputeNetworkBroker(wallet);
}

// FIX 2: a fresh wallet has NO ledger yet — depositFund alone reverts on it.
// First run must addLedger(minZG) (creates + funds); a rerun already has a
// ledger, so addLedger would throw — fall back to depositFund (or a no-op if
// it's already funded above the minimum).
export async function ensureLedgerFunded(
	broker: ZGBroker,
	minZG: number,
): Promise<void> {
	try {
		await broker.ledger.getLedger();
		// Ledger already exists — no-op on rerun rather than re-depositing on
		// every invocation (that would drain the funded wallet across runs).
		return;
	} catch {
		// No ledger for this wallet yet — create and fund it in one call.
	}

	try {
		await broker.ledger.addLedger(minZG);
	} catch (e) {
		// Lost a race / already created between getLedger() and here — fall
		// back to topping up the existing ledger.
		const msg = e instanceof Error ? e.message : String(e);
		if (/ledger.*exist|already/i.test(msg)) {
			await broker.ledger.depositFund(minZG);
		} else {
			throw e;
		}
	}
}

export async function infer(
	broker: ZGBroker,
	cfg: Config,
	prompt: string,
): Promise<InferResult> {
	// FIX 3: acknowledge the provider's TEE signer once before the first
	// inference. On reruns this throws "already acknowledged" — ignore that.
	try {
		await broker.inference.acknowledgeProviderSigner(cfg.provider);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (!/already/i.test(msg)) throw e;
	}

	// FIX 4: the provider's own metadata is the source of truth for the model
	// name — cfg.model is at best an optional override, never hardcoded.
	const meta = await broker.inference.getServiceMetadata(
		cfg.provider,
		cfg.model,
	);
	const endpoint: string = meta.endpoint;
	const model: string = meta.model;

	const messages = [{ role: "user", content: prompt }];
	const headers = await broker.inference.getRequestHeaders(
		cfg.provider,
		JSON.stringify(messages),
	);

	const t0 = Date.now();
	const res = await fetch(`${endpoint}/chat/completions`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({ model, messages }),
	});
	const latencyMs = Date.now() - t0;
	const data: any = await res.json();

	const resultText: string = data?.choices?.[0]?.message?.content ?? "";
	const chatID: string =
		res.headers.get("ZG-Res-Key") ??
		res.headers.get("zg-res-key") ??
		data?.id ??
		"";

	// `endpoint` from getServiceMetadata already ends in `/v1/proxy` (see the
	// SDK's RequestProcessor.getServiceMetadata), so only append `/signature`.
	// The SDK's own verifier.fetchSignatureByChatID builds the same URL from
	// the provider's base `url` + `/v1/proxy/signature/...`.
	const proofUrl = `${endpoint}/signature/${chatID}?model=${encodeURIComponent(
		model,
	)}`;

	// FIX 5: no chatID means there is nothing to fetch a signature for —
	// treat it as a failed (unverified) attempt rather than hitting the
	// signature endpoint with an empty id.
	if (!chatID) {
		return {
			resultText,
			signedText: "",
			signature: "",
			signer: null,
			chatID: "",
			latencyMs,
			processResponseOk: false,
			verified: false,
			proofUrl,
		};
	}

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
