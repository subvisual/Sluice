export type InferResult = {
	resultText: string;
	signedText: string;
	signature: string;
	signer: string | null;
	chatID: string;
	latencyMs: number;
	processResponseOk: boolean;
	verified: boolean;
	proofUrl: string;
};

export function computeVerified(
	signer: string | null,
	processResponseOk: boolean,
): boolean {
	return signer !== null && processResponseOk;
}

export function formatOutput(r: InferResult): string {
	const mark = r.verified ? "✓" : "✗";
	return [
		`result: ${r.resultText}`,
		``,
		`proof:`,
		`  signer      ${r.signer ?? "(recovery failed)"}`,
		`  verified    ${mark}  (EIP-191 recover + processResponse)`,
		`  signature   ${r.signature}`,
		`  proof URL   ${r.proofUrl}`,
		`  chatID      ${r.chatID}   latency ${r.latencyMs}ms`,
	].join("\n");
}
