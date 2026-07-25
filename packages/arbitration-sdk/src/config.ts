export type Config = {
	rpc: string;
	provider: string;
	model: string;
	depositZG: number;
	privateKey: string;
};

export function loadConfig(): Config {
	const privateKey = process.env.ZG_PRIVATE_KEY?.trim();
	if (!privateKey) {
		throw new Error(
			"ZG_PRIVATE_KEY is required. Copy .env.example to .env and set a funded Galileo key.",
		);
	}
	return {
		rpc: process.env.ZG_RPC ?? "https://evmrpc-testnet.0g.ai",
		provider:
			process.env.ZG_PROVIDER ?? "0xa48f01287233509FD694a22Bf840225062E67836",
		model: process.env.ZG_MODEL ?? "qwen/qwen2.5-omni-7b",
		depositZG: Number(process.env.ZG_DEPOSIT ?? "3"),
		privateKey,
	};
}
