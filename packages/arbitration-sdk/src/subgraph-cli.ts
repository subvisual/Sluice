// Read a maker's book from the Aqua subgraph.
//
//   npm run subgraph -- meta [--url <endpoint>]
//   npm run subgraph -- book <makerAddress> [--url <endpoint>]
//
// Defaults to the deployed Studio Base subgraph; SLUICE_SUBGRAPH_URL or --url
// point it at the local fork graph-node instead.

import "dotenv/config";
import {
	fetchMeta,
	fetchUserBook,
	subgraphUrl,
	type UserBook,
} from "./subgraph.ts";

const USAGE = `Usage:
  npm run subgraph -- meta [--url <endpoint>]
  npm run subgraph -- book <makerAddress> [--url <endpoint>]

Default endpoint: deployed Studio Base subgraph (override with --url or SLUICE_SUBGRAPH_URL).`;

function parseUrl(argv: string[]): string {
	const i = argv.indexOf("--url");
	return i !== -1 && argv[i + 1] ? argv[i + 1] : subgraphUrl();
}

function printBook(book: UserBook): void {
	console.log(`maker:   ${book.maker}`);
	console.log(
		`strategies: ${book.liveStrategyCount} live / ${book.strategyCount} total`,
	);

	console.log("\ncommitted book (per token):");
	if (book.tokenBooks.length === 0) {
		console.log("  (none)");
	} else {
		for (const b of book.tokenBooks) {
			console.log(
				`  ${(b.symbol ?? b.tokenAddress).padEnd(8)} ${b.committedVirtualHuman.padStart(20)}  (${b.liveStrategyCount} live)`,
			);
		}
	}

	console.log("\nlive strategies:");
	if (book.liveStrategies.length === 0) {
		console.log("  (none)");
	} else {
		for (const s of book.liveStrategies) {
			const bal = s.balances
				.map((x) => `${x.virtualBalanceHuman} ${x.symbol ?? "?"}`)
				.join(", ");
			console.log(
				`  ${s.strategyHash.slice(0, 12)}…  [${bal}]  fills: ${s.fillCount}`,
			);
		}
	}

	console.log("\nrecent fills:");
	if (book.recentFills.length === 0) {
		console.log("  (none)");
	} else {
		for (const f of book.recentFills) {
			console.log(
				`  ${f.amountInHuman} ${f.tokenIn ?? "?"} → ${f.amountOutHuman} ${f.tokenOut ?? "?"}  (block ${f.block})`,
			);
		}
	}
}

async function main() {
	const argv = process.argv.slice(2);
	const cmd = argv[0];
	const url = parseUrl(argv);

	if (cmd === "meta") {
		const meta = await fetchMeta(url);
		console.log(`endpoint:   ${url}`);
		console.log(`deployment: ${meta.deployment}`);
		console.log(`head block: ${meta.block}`);
		console.log(`indexing errors: ${meta.hasIndexingErrors}`);
		return;
	}

	if (cmd === "book") {
		const maker = argv[1];
		if (!maker || maker.startsWith("--")) {
			console.error(`missing <makerAddress>\n\n${USAGE}`);
			process.exit(2);
		}
		console.log(`endpoint: ${url}\n`);
		const book = await fetchUserBook(maker, url);
		printBook(book);
		return;
	}

	console.error(USAGE);
	process.exit(2);
}

main().catch((e) => {
	console.error("subgraph query failed:", e instanceof Error ? e.message : e);
	process.exit(1);
});
