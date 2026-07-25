import { ethers } from "ethers";
import { loadConfig } from "./config.ts";
import { initBroker, ensureLedgerFunded, type ZGBroker } from "./inference.ts";

// Funds the 0G compute ledger without running an inference.
//
//   npm run fund            # ensure the ledger exists (seeds ZG_DEPOSIT on first run)
//   npm run fund -- 5       # deposit 5 OG on top of whatever is there
//
// The no-arg form is idempotent (ensureLedgerFunded's existence-only contract);
// the amount form is an explicit top-up and always moves funds.

async function printBalances(
	broker: ZGBroker,
	wallet: ethers.Wallet,
): Promise<void> {
	const walletBalance = await wallet.provider!.getBalance(wallet.address);
	console.log(
		`wallet ${wallet.address}: ${ethers.formatEther(walletBalance)} OG`,
	);
	try {
		const ledger = await broker.ledger.getLedger();
		console.log(
			`ledger available: ${ethers.formatEther(ledger.availableBalance)} OG`,
		);
	} catch {
		console.log("ledger: none yet");
	}
}

async function main() {
	const amountArg = process.argv[2]?.trim();
	let amount: number | undefined;
	if (amountArg !== undefined && amountArg !== "") {
		amount = Number(amountArg);
		if (!Number.isFinite(amount) || amount <= 0) {
			console.error("Usage: npm run fund [-- <OG amount>]");
			process.exit(2);
		}
	}

	const cfg = loadConfig();
	const provider = new ethers.JsonRpcProvider(cfg.rpc);
	const wallet = new ethers.Wallet(cfg.privateKey, provider);
	const broker = await initBroker(wallet);

	await printBalances(broker, wallet);

	if (amount === undefined) {
		await ensureLedgerFunded(broker, cfg.depositZG);
	} else {
		// Explicit top-up. depositFund reverts on a wallet with no ledger, so
		// probe first and create-and-fund in that case (same split as
		// ensureLedgerFunded, but here the deposit is unconditional).
		let ledgerExists = true;
		try {
			await broker.ledger.getLedger();
		} catch {
			ledgerExists = false;
		}
		if (ledgerExists) {
			await broker.ledger.depositFund(amount);
		} else {
			await broker.ledger.addLedger(amount);
		}
		console.log(`deposited ${amount} OG`);
	}

	await printBalances(broker, wallet);
}

main().catch((e) => {
	console.error("fund failed:", e instanceof Error ? e.message : e);
	process.exit(1);
});
